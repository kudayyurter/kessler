"""One-off: rebuilds crowding day files for the days before live files existed, from the
orbit-history archive (see docs/superpowers/specs/2026-09-28-crowding-design.md, Backend).

A day's state is every catalogued object's latest element set archived on or before that day, as
of the day's last archived run. Days that already have a file (live or earlier backfills) are left
alone, so running it again writes nothing."""
import logging
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import psycopg

from app.crowding.format import (
    DAYS_PREFIX,
    HISTORY_START,
    day_key,
    index_entry,
    pack_day,
    read_header,
)
from app.crowding.publish import update_index
from app.history.archive import day_prefix, element_set_id
from app.history.read import read_history
from app.ingest.runlog import GLOBE_LOCK, advisory_lock, run_log
from app.ingest.snapshot import SnapshotStore

log = logging.getLogger(__name__)

STALE_AFTER = timedelta(days=30)
CATALOGUE_SQL = "SELECT norad_id, owner, object_type, decay_date, regime FROM objects"
_RUN_TIME = re.compile(r"/([0-9]{6})Z-[^/]*\.jsonl\.gz$")


@dataclass(frozen=True)
class Elements:
    epoch: datetime
    mean_motion: float
    eccentricity: float
    inclination: float


def parse_elements(record: dict) -> tuple[int, Elements] | None:
    ident = element_set_id(record)
    if ident is None:
        return None
    try:
        mm = float(record["MEAN_MOTION"])
        ecc = float(record["ECCENTRICITY"])
        inc = float(record["INCLINATION"])
    except (KeyError, TypeError, ValueError):
        return None
    return ident[0], Elements(ident[1], mm, ecc, inc)


def last_run_time(store: SnapshotStore, day: date) -> datetime | None:
    """When the day's last archived run started (read from its key), or None without files."""
    times = []
    for key in store.keys(day_prefix(day)):
        match = _RUN_TIME.search(key)
        if match:
            t = datetime.strptime(match.group(1), "%H%M%S").time()
            times.append(datetime.combine(day, t, tzinfo=UTC))
    return max(times, default=None)


def state_rows(
    latest: dict[int, Elements], catalogue: dict[int, dict], day: date, as_of: datetime
) -> list[dict]:
    """The globe's population on `day` as the archive knew it at `as_of`: catalogued, not beyond
    Earth orbit, not re-entered by that day, and an element set at most STALE_AFTER old."""
    rows = []
    for norad_id, el in latest.items():
        obj = catalogue.get(norad_id)
        if obj is None or obj["regime"] == "OTHER":
            continue
        if obj["decay_date"] is not None and obj["decay_date"] <= day:
            continue
        if el.epoch < as_of - STALE_AFTER:
            continue
        rows.append({"norad_id": norad_id, "owner": obj["owner"], "object_type": obj["object_type"],
                     "mean_motion": el.mean_motion, "eccentricity": el.eccentricity,
                     "inclination": el.inclination})
    return rows


def backfill(conn: psycopg.Connection, store: SnapshotStore, today: date) -> list[dict]:
    """Writes the missing day files from HISTORY_START to the day before `today` and returns their
    index entries."""
    existing = set(store.keys(DAYS_PREFIX))
    catalogue = {r["norad_id"]: r for r in conn.execute(CATALOGUE_SQL).fetchall()}
    latest: dict[int, Elements] = {}
    written: list[dict] = []
    day = HISTORY_START
    while day < today:
        for record in read_history(store, day, day):
            parsed = parse_elements(record)
            if parsed is None:
                continue
            norad_id, el = parsed
            previous = latest.get(norad_id)
            if previous is None or el.epoch > previous.epoch:
                latest[norad_id] = el
        as_of = last_run_time(store, day)
        if as_of is not None and day_key(day) not in existing:
            data = pack_day(state_rows(latest, catalogue, day, as_of), day=day,
                            generated_at=as_of, generation=None, source="archive")
            store.put(day_key(day), data)
            written.append(index_entry(read_header(data)))
        day += timedelta(days=1)
    return written


def run_backfill_crowding(
    conn: psycopg.Connection, store: SnapshotStore, database_url: str,
    now: datetime | None = None,
) -> int:
    now = now or datetime.now(UTC)
    with run_log(conn, "backfill_crowding") as run, advisory_lock(database_url, GLOBE_LOCK):
        run.source = "archive"
        written = backfill(conn, store, now.astimezone(UTC).date())
        if written:
            update_index(conn, store, written)
        run.rows = len(written)
    log.info("backfill_crowding wrote %d day files", run.rows)
    return run.rows
