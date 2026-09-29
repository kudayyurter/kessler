import gzip
import json
import math
import struct

import pytest

from kessler_crowding.crw1 import encode_day
from kessler_crowding.reference import COLS, EDGES, RE, ROWS, cells, column, fraction_below, row_of


def test_grid_shape():
    assert (ROWS, COLS) == (79, 91)
    assert EDGES[1] == 200 and EDGES[73] == 2000 and EDGES[77] == 35586 and EDGES[78] == 35986


@pytest.mark.parametrize(("inc", "col"), [
    (0.0, 0), (0.49, 0), (0.5, 1), (52.5, 27), (53.05, 27), (54.49, 27), (54.5, 28),
    (70.0, 35), (97.6, 49), (178.5, 90), (180.0, 90),
])
def test_columns_have_half_degree_edges(inc, col):
    assert column(inc) == col


@pytest.mark.parametrize(("alt", "row"), [
    (-50, 0), (199.9, 0), (200, 1), (224.99, 1), (225, 2), (460, 11), (1999.9, 72), (2000, 73),
    (20182, 75), (35786, 77), (36000, 78),
])
def test_rows(alt, row):
    assert row_of(alt) == row


def test_time_below_the_semi_major_axis_is_known_in_closed_form():
    # Fraction of an orbit with r <= a is (pi/2 - e) / pi.
    assert fraction_below(10000, 0.5, 10000) == pytest.approx(0.5 - 0.5 / math.pi, abs=1e-12)
    assert fraction_below(10000, 0.5, 4999) == 0
    assert fraction_below(10000, 0.5, 15001) == 1


def test_a_gto_spreads_over_many_rows_and_sums_to_one():
    a = RE + (250 + 35786) / 2
    e = 35536 / (2 * RE + 36036)
    out = cells(a, e, 27.0)
    assert len(out) > 10 and {c for _, c, _ in out} == {column(27.0)}
    assert sum(w for _, _, w in out) == pytest.approx(1, abs=1e-12)


def test_circular_orbits_sit_in_one_cell():
    assert cells(RE + 460, 0.0, 53.0) == [(11, 27, 1.0)]
    assert cells(RE + 150, 5e-7, 51.6) == [(0, 26, 1.0)]


@pytest.mark.parametrize(("a", "e", "inc"), [
    (RE + 500, 1.0, 53), (RE + 500, 1.2, 53), (RE + 500, -0.1, 53), (RE + 500, 0.001, 190),
    (float("nan"), 0.001, 53), (-5, 0.001, 53),
])
def test_unplaceable_orbits(a, e, inc):
    assert cells(a, e, inc) is None


def test_encoded_day_file_layout():
    data = encode_day(
        [
            {"norad_id": 7, "owner": "US", "type": "DEB", "sma_km": 6838.137, "ecc": 0.0001,
             "inc": 53.0},
            {"norad_id": 3, "owner": "PRC", "type": "PAY", "sma_km": 7000.0, "ecc": 0.5,
             "inc": 97.6},
        ],
        day="2026-09-22", generated_at="2026-09-22T18:41:32+00:00", generation=None,
        source="archive",
    )
    raw = gzip.decompress(data)
    assert raw[:4] == b"CRW1"
    (hl,) = struct.unpack_from("<I", raw, 4)
    header = json.loads(raw[8 : 8 + hl])
    assert header["count"] == 2 and header["owners"] == ["PRC", "US"]
    off = 8 + hl
    assert struct.unpack_from("<2I", raw, off) == (3, 4)          # delta-coded NORAD IDs
    assert struct.unpack_from("<2H", raw, off + 8) == (0, 1)      # owner indices
    assert struct.unpack_from("<2B", raw, off + 12) == (0, 2)     # PAY, DEB
    assert struct.unpack_from("<2I", raw, off + 14) == (70000, 68381)
    assert struct.unpack_from("<2I", raw, off + 22) == (500000, 100)
    assert struct.unpack_from("<2H", raw, off + 30) == (9760, 5300)
