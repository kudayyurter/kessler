"""A second, independent CRW1 encoder (the API has its own): fixtures written with it check the
web decoder against the spec's layout."""
import gzip
import json
import struct

TYPES = ["PAY", "R/B", "DEB", "UNK"]
COLUMNS = [
    {"name": "norad_delta", "dtype": "u32"}, {"name": "owner", "dtype": "u16"},
    {"name": "type", "dtype": "u8"}, {"name": "sma_dkm", "dtype": "u32"},
    {"name": "ecc_e6", "dtype": "u32"}, {"name": "inc_cdeg", "dtype": "u16"},
]


def encode_day(objects: list[dict], *, day: str, generated_at: str, generation: str | None,
               source: str) -> bytes:
    """`objects` carry norad_id, owner, type, sma_km, ecc and inc."""
    objs = sorted(objects, key=lambda o: o["norad_id"])
    owners = sorted({o["owner"] for o in objs})
    header = {"version": 1, "day": day, "generated_at": generated_at, "generation": generation,
              "source": source, "count": len(objs), "skipped": 0, "owners": owners,
              "types": TYPES, "columns": COLUMNS}
    head = json.dumps(header, separators=(",", ":")).encode()
    n = len(objs)
    ids = [o["norad_id"] for o in objs]
    body = b"CRW1" + struct.pack("<I", len(head)) + head
    body += struct.pack(f"<{n}I", *[b - a for a, b in zip([0, *ids[:-1]], ids, strict=True)])
    body += struct.pack(f"<{n}H", *[owners.index(o["owner"]) for o in objs])
    body += struct.pack(f"<{n}B", *[TYPES.index(o["type"]) for o in objs])
    body += struct.pack(f"<{n}I", *[round(o["sma_km"] * 10) for o in objs])
    body += struct.pack(f"<{n}I", *[round(o["ecc"] * 1e6) for o in objs])
    body += struct.pack(f"<{n}H", *[round(o["inc"] * 100) for o in objs])
    return gzip.compress(body, mtime=0)
