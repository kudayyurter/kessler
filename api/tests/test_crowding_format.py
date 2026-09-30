import gzip
import itertools
from datetime import UTC, date, datetime

import pytest

from app.crowding.format import (
    COLUMNS,
    HISTORY_START,
    day_key,
    index_entry,
    pack_day,
    read_header,
    semi_major_axis_km,
    unpack_day,
)

T = datetime(2026, 9, 28, 12, 41, 32, tzinfo=UTC)
DAY = date(2026, 9, 28)
GEN = "20260928T124132Z-r37"


def row(norad_id: int, **kw) -> dict:
    return {"norad_id": norad_id, "owner": "US", "object_type": "PAY", "mean_motion": 15.5,
            "eccentricity": 0.0012, "inclination": 53.05, **kw}


def ids(cols: dict) -> list[int]:
    return list(itertools.accumulate(cols["norad_delta"]))


def test_day_key_and_history_start():
    assert day_key(DAY) == "crowding/days/2026-09-28.bin.gz"
    assert HISTORY_START == date(2026, 9, 25)


def test_semi_major_axis_of_the_iss():
    # 15.49224498 rev/day → a ≈ 6797.13 km, 419 km above R_E = 6378.137 km.
    assert semi_major_axis_km(15.49224498) == pytest.approx(6797.13, abs=0.01)


def test_round_trip_sorts_by_norad_and_keeps_precision():
    rows = [
        row(25544, owner="ISS", mean_motion=15.49224498, eccentricity=0.00047657, inclination=51.6312),
        row(44713),
        row(1, owner="PRC", object_type="R/B", mean_motion=2.00563, eccentricity=0.7123, inclination=27.0),
    ]
    data = pack_day(rows, day=DAY, generated_at=T, generation=GEN, source="live")
    header, cols = unpack_day(data)
    assert header == {
        "version": 1, "day": "2026-09-28", "generated_at": "2026-09-28T12:41:32+00:00",
        "generation": GEN, "source": "live", "count": 3, "skipped": 0,
        "owners": ["ISS", "PRC", "US"], "types": ["PAY", "R/B", "DEB", "UNK"], "columns": COLUMNS,
    }
    assert ids(cols) == [1, 25544, 44713]
    assert [header["owners"][i] for i in cols["owner"]] == ["PRC", "ISS", "US"]
    assert [header["types"][i] for i in cols["type"]] == ["R/B", "PAY", "PAY"]
    assert cols["sma_dkm"][1] / 10 == pytest.approx(semi_major_axis_km(15.49224498), abs=0.05)
    assert cols["ecc_e6"][1] == 477
    assert cols["inc_cdeg"][1] == 5163
    assert read_header(data) == header


def test_unencodable_rows_are_skipped_and_counted():
    rows = [row(1), row(2, mean_motion=0.0), row(3, eccentricity=float("nan")),
            row(4, inclination=181.0), row(5, eccentricity=-0.1), row(6, eccentricity=1.2)]
    header, cols = unpack_day(pack_day(rows, day=DAY, generated_at=T, generation=None, source="archive"))
    # e = 1.2 is encodable (the browser skips it when binning); the other four are not.
    assert (header["count"], header["skipped"]) == (2, 4)
    assert ids(cols) == [1, 6]
    assert cols["ecc_e6"][1] == 1_200_000


def test_empty_day():
    header, cols = unpack_day(pack_day([], day=DAY, generated_at=T, generation=None, source="live"))
    assert header["count"] == 0
    assert all(values == [] for values in cols.values())


def test_packing_is_deterministic():
    a = pack_day([row(1)], day=DAY, generated_at=T, generation=GEN, source="live")
    b = pack_day([row(1)], day=DAY, generated_at=T, generation=GEN, source="live")
    assert a == b


def test_not_a_day_file():
    with pytest.raises(ValueError, match="CRW1"):
        unpack_day(gzip.compress(b"LEO1\x00\x00\x00\x00"))


def test_index_entry():
    header = read_header(pack_day([row(1)], day=DAY, generated_at=T, generation=GEN, source="live"))
    assert index_entry(header) == {"day": "2026-09-28", "generated_at": "2026-09-28T12:41:32+00:00",
                                   "count": 1, "source": "live", "generation": GEN}
