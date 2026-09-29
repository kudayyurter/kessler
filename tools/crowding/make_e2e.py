"""Write the small, deterministic crowding fixtures the web's Playwright tests serve: two days and
an index. Every object and change is listed here so the tests' expectations can be read off."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from kessler_crowding.crw1 import encode_day
from kessler_crowding.reference import RE

OUT = Path(__file__).resolve().parents[2] / "web" / "tests" / "fixtures" / "crowding"


def circ(
    norad_id: int, owner: str, type_: str, alt: float, inc: float, ecc: float = 0.0001
) -> dict:
    return {"norad_id": norad_id, "owner": owner, "type": type_, "sma_km": RE + alt, "ecc": ecc,
            "inc": inc}


GTO = {"norad_id": 202, "owner": "US", "type": "R/B", "sma_km": RE + (250 + 35786) / 2,
       "ecc": 35536 / (2 * RE + 36036), "inc": 27.0}
BOTH = [circ(101 + k, "US", "PAY", 460, 53.0) for k in range(8)] + [
    circ(201, "PRC", "DEB", 800, 98.2, ecc=0.001),   # sun-synchronous debris
    GTO,                                             # spreads over LEO rows and the high strip
    circ(203, "US", "PAY", 35786, 0.05, ecc=0.0002), # GEO belt
]
DAY1 = BOTH + [
    circ(301, "US", "PAY", 530, 70.0),   # moves down 25 km on day 2 (525–550 → 500–525)
    circ(302, "US", "PAY", 549, 70.0),   # 2 km of jitter across the 550 km edge: not a move
    circ(501, "US", "PAY", 190, 51.6),   # re-enters on day 2 (floor row)
    circ(502, "US", "DEB", 700, 82.0),   # no longer tracked on day 2
]
DAY2 = BOTH + [
    circ(301, "US", "PAY", 505, 70.0),
    circ(302, "US", "PAY", 551, 70.0),
    circ(401, "PRC", "DEB", 460, 53.0),  # newly catalogued, joins the hot cell (9 objects)
]
DAYS = [
    ("2026-09-22", "2026-09-22T18:41:32+00:00", None, "archive", DAY1),
    ("2026-09-23", "2026-09-23T12:00:00+00:00", "20260923T120000Z-r1", "live", DAY2),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = []
    for day, at, gen, source, objs in DAYS:
        (OUT / f"day-{day}.bin.gz").write_bytes(
            encode_day(objs, day=day, generated_at=at, generation=gen, source=source))
        entries.append({"day": day, "generated_at": at, "count": len(objs), "source": source,
                        "generation": gen})
    index = {"version": 1, "history_start": "2026-09-22", "days": entries,
             "latest": {"day": "2026-09-23", "generation": "20260923T120000Z-r1"},
             "reentries": {"501": "2026-09-23"}}
    (OUT / "index.json").write_text(json.dumps(index, indent=1) + "\n")
    print(f"wrote {len(DAYS)} days and index.json to {OUT}")


if __name__ == "__main__":
    main()
