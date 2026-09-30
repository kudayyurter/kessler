"""CRW1 daily crowding state files: one row per object with the orbit numbers the browser needs to
bin objects by altitude and inclination. See docs/superpowers/specs/2026-09-28-crowding-design.md.

Layout: b"CRW1", a little-endian u32 header length, a JSON header, then little-endian column
arrays of `count` values each, sorted by NORAD ID; the whole file is gzipped."""
import gzip
import json
import math
import struct
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime

from app.domain.orbits import OBJECT_TYPES

MAGIC = b"CRW1"
VERSION = 1
DAYS_PREFIX = "crowding/days/"
INDEX_KEY = "crowding/index.json"
HISTORY_START = date(2026, 9, 25)
MU_KM3_S2 = 398600.4418
COLUMNS: list[dict[str, str]] = [
    {"name": "norad_delta", "dtype": "u32"},
    {"name": "owner", "dtype": "u16"},
    {"name": "type", "dtype": "u8"},
    {"name": "sma_dkm", "dtype": "u32"},
    {"name": "ecc_e6", "dtype": "u32"},
    {"name": "inc_cdeg", "dtype": "u16"},
]
_CODES = {"u32": ("I", 0xFFFFFFFF), "u16": ("H", 0xFFFF), "u8": ("B", 0xFF)}


def day_key(day: date) -> str:
    return f"{DAYS_PREFIX}{day.isoformat()}.bin.gz"


def semi_major_axis_km(mean_motion: float) -> float:
    """Semi-major axis (km) from a mean motion in revolutions per day."""
    n = mean_motion * 2 * math.pi / 86400
    return (MU_KM3_S2 / (n * n)) ** (1 / 3)


def _encodable(row: Mapping) -> bool:
    values = (row["mean_motion"], row["eccentricity"], row["inclination"])
    if not all(isinstance(v, int | float) and math.isfinite(v) for v in values):
        return False
    return row["mean_motion"] > 0 and row["eccentricity"] >= 0 and 0 <= row["inclination"] <= 180


def pack_day(
    rows: Iterable[Mapping], *, day: date, generated_at: datetime, generation: str | None,
    source: str,
) -> bytes:
    """Packs one day's objects. Rows whose numbers can't be encoded (non-finite, a non-positive mean
    motion, a negative eccentricity, an inclination outside 0–180°) are left out and counted in the
    header's `skipped`."""
    rows = list(rows)
    kept = sorted((r for r in rows if _encodable(r)), key=lambda r: r["norad_id"])
    owners = sorted({r["owner"] for r in kept})
    owner_index = {code: i for i, code in enumerate(owners)}
    deltas, previous = [], 0
    for r in kept:
        deltas.append(r["norad_id"] - previous)
        previous = r["norad_id"]
    columns = {
        "norad_delta": deltas,
        "owner": [owner_index[r["owner"]] for r in kept],
        "type": [OBJECT_TYPES.index(r["object_type"]) for r in kept],
        "sma_dkm": [round(semi_major_axis_km(r["mean_motion"]) * 10) for r in kept],
        "ecc_e6": [round(r["eccentricity"] * 1e6) for r in kept],
        "inc_cdeg": [round(r["inclination"] * 100) for r in kept],
    }
    header = {
        "version": VERSION, "day": day.isoformat(),
        "generated_at": generated_at.astimezone(UTC).isoformat(), "generation": generation,
        "source": source, "count": len(kept), "skipped": len(rows) - len(kept), "owners": owners,
        "types": list(OBJECT_TYPES), "columns": COLUMNS,
    }
    head = json.dumps(header, separators=(",", ":")).encode()
    body = bytearray(MAGIC + struct.pack("<I", len(head)) + head)
    for col in COLUMNS:
        code, top = _CODES[col["dtype"]]
        values = [min(max(v, 0), top) for v in columns[col["name"]]]
        body += struct.pack(f"<{len(values)}{code}", *values)
    return gzip.compress(bytes(body), compresslevel=6, mtime=0)


def _header(raw: bytes) -> tuple[dict, int]:
    if raw[:4] != MAGIC:
        raise ValueError("not a CRW1 day file")
    (length,) = struct.unpack_from("<I", raw, 4)
    return json.loads(raw[8 : 8 + length]), 8 + length


def read_header(data: bytes) -> dict:
    return _header(gzip.decompress(data))[0]


def unpack_day(data: bytes) -> tuple[dict, dict[str, list[int]]]:
    raw = gzip.decompress(data)
    header, offset = _header(raw)
    n = header["count"]
    columns: dict[str, list[int]] = {}
    for col in header["columns"]:
        code, _ = _CODES[col["dtype"]]
        columns[col["name"]] = list(struct.unpack_from(f"<{n}{code}", raw, offset))
        offset += struct.calcsize(f"<{code}") * n
    return header, columns


def index_entry(header: dict) -> dict:
    return {key: header[key] for key in ("day", "generated_at", "count", "source", "generation")}
