"""Fetch the live globe snapshots, pick ~200 objects covering every kind of orbit plus synthetic
edge cases, and write the frozen golden fixture the web's crowding tests compare against.
Run once by hand; commit the output."""
import gzip
import json
import math
import struct
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kessler_crowding.reference import EDGES, RE, cells, sma_km

BASE = "https://kessler.kudayyurter.dev/api/globe/snapshot"
OUT = Path(__file__).resolve().parents[2] / "web/tests/fixtures/crowding/golden.json"
RECORD = struct.Struct("<IHBx10d")


def fetch(group: str) -> list[dict]:
    req = urllib.request.Request(
        f"{BASE}?group={group}", headers={"User-Agent": "kessler-crowding/0.1"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        raw = gzip.decompress(resp.read())
    (hl,) = struct.unpack_from("<I", raw, 4)
    header = json.loads(raw[8 : 8 + hl])
    out = []
    for i in range(header["count"]):
        r = RECORD.unpack_from(raw, 8 + hl + i * RECORD.size)
        out.append({"norad_id": r[0], "sma_km": sma_km(r[4]), "ecc": r[5], "inc": r[6]})
    return out


def alt(o: dict) -> float:
    return o["sma_km"] - RE


def near_inc_edge(o: dict) -> bool:
    """Within 0.01° of a column edge (edges sit at 0.5°, 2.5°, …)."""
    return abs(((o["inc"] - 0.5) % 2) - 1) > 0.99


def near_alt_edge(o: dict) -> bool:
    """A near-circular orbit within 0.5 km of a row edge."""
    return o["ecc"] < 1e-4 and min(abs(alt(o) - e) for e in EDGES[1:-1]) < 0.5


def pick(objs: list[dict]) -> list[dict]:
    buckets = [
        (50, lambda o: o["ecc"] < 1e-4 and alt(o) < 2000),
        (30, lambda o: 0.001 < o["ecc"] < 0.05 and alt(o) < 2000),
        (10, lambda o: o["sma_km"] * (1 - o["ecc"]) - RE < 200),
        (20, lambda o: o["ecc"] > 0.5),
        (15, lambda o: 18000 <= alt(o) < 25000),
        (15, lambda o: 35586 <= alt(o) < 35986),
        (15, lambda o: 96.5 <= o["inc"] < 98.5),
        (10, lambda o: o["inc"] > 100 and not 96.5 <= o["inc"] < 98.5),
        (10, near_inc_edge),
        (10, near_alt_edge),
    ]
    chosen: dict[int, dict] = {}
    for n, test in buckets:
        for o in sorted(objs, key=lambda o: o["norad_id"]):
            if n == 0:
                break
            if o["norad_id"] not in chosen and test(o):
                chosen[o["norad_id"]] = o
                n -= 1
    return list(chosen.values())


SYNTHETIC = [
    {"norad_id": 900001, "sma_km": RE + 450, "ecc": 0.0, "inc": 0.5},
    {"norad_id": 900002, "sma_km": RE + 450, "ecc": 0.0, "inc": 52.5},
    {"norad_id": 900003, "sma_km": RE + 450, "ecc": 0.0, "inc": 54.5},
    {"norad_id": 900004, "sma_km": RE + 450, "ecc": 0.0, "inc": 180.0},
    {"norad_id": 900005, "sma_km": RE + 450, "ecc": 0.0, "inc": 0.0},
    {"norad_id": 900006, "sma_km": RE + 450, "ecc": 1.2, "inc": 53.0},
    {"norad_id": 900007, "sma_km": RE + 450, "ecc": 0.001, "inc": 190.0},
    {"norad_id": 900008, "sma_km": RE + 150, "ecc": 0.0, "inc": 51.6},
    {"norad_id": 900009, "sma_km": RE + 50000, "ecc": 0.0, "inc": 5.0},
    {"norad_id": 900010, "sma_km": RE + 700, "ecc": 1e-7, "inc": 98.0},
    {"norad_id": 900011, "sma_km": RE + 225, "ecc": 0.0, "inc": 30.0},
    {"norad_id": 900012, "sma_km": RE + 600, "ecc": 0.3, "inc": 63.4},
]


def main() -> None:
    objs = pick(fetch("LEO") + fetch("HIGH")) + SYNTHETIC
    out = [{**o, "cells": cells(o["sma_km"], o["ecc"], o["inc"])} for o in objs]
    for o in out:
        assert o["cells"] is None or math.isclose(sum(w for *_, w in o["cells"]), 1, abs_tol=1e-9)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"source": f"{BASE} + synthetic", "objects": out}, indent=1) + "\n")
    print(f"wrote {len(out)} objects to {OUT}")


if __name__ == "__main__":
    main()
