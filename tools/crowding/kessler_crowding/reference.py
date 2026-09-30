"""Independent reference for the crowding grid (see the Measurements section of
docs/superpowers/specs/2026-09-28-crowding-design.md). Written from the spec, not from the web
code: the web's golden test compares its binning against this."""
import math

MU = 398600.4418
RE = 6378.137
EDGES = ([-math.inf] + [200.0 + 25.0 * k for k in range(73)]
         + [8000.0, 18000.0, 25000.0, 35586.0, 35986.0, math.inf])
ROWS = len(EDGES) - 1
COLS = 91
CIRCULAR = 1e-6


def sma_km(mean_motion: float) -> float:
    n = mean_motion * 2 * math.pi / 86400
    return (MU / (n * n)) ** (1 / 3)


def column(inc: float) -> int:
    return max(0, min(math.floor((inc - 0.5) / 2) + 1, COLS - 1))


def row_of(alt: float) -> int:
    for k in range(ROWS):
        if EDGES[k] <= alt < EDGES[k + 1]:
            return k
    return ROWS - 1


def fraction_below(a: float, e: float, r: float) -> float:
    """Fraction of the orbit spent at radius <= r (Kepler: M = E - e sin E)."""
    if r <= a * (1 - e):
        return 0.0
    if r >= a * (1 + e):
        return 1.0
    big_e = math.acos(max(-1.0, min(1.0, (1 - r / a) / e)))
    return (big_e - e * math.sin(big_e)) / math.pi


def cells(a: float, e: float, inc: float) -> list[tuple[int, int, float]] | None:
    """(row, column, weight) for every cell the orbit spends time in, or None if unplaceable."""
    if not (math.isfinite(a) and a > 0 and math.isfinite(e) and 0 <= e < 1
            and math.isfinite(inc) and 0 <= inc <= 180):
        return None
    col = column(inc)
    if e < CIRCULAR:
        return [(row_of(a - RE), col, 1.0)]
    out = []
    for k in range(ROWS):
        w = fraction_below(a, e, RE + EDGES[k + 1]) - fraction_below(a, e, RE + EDGES[k])
        if w > 0:
            out.append((k, col, w))
    return out
