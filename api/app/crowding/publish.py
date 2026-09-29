"""Writes today's crowding day file from the globe's rows and keeps crowding/index.json current
(see docs/superpowers/specs/2026-09-28-crowding-design.md, Backend)."""
import json
import logging
from collections.abc import Iterable
from datetime import UTC, datetime

import psycopg

from app.crowding.format import (
    DAYS_PREFIX,
    HISTORY_START,
    INDEX_KEY,
    day_key,
    index_entry,
    pack_day,
    read_header,
)
from app.ingest.runlog import GLOBE_LOCK, advisory_lock, run_log
from app.ingest.snapshot import GROUP_ROWS_SQL, SNAPSHOT_GROUPS, SnapshotStore, read_pointer

log = logging.getLogger(__name__)

REENTRIES_SQL = "SELECT norad_id, decay_date FROM objects WHERE decay_date >= %s ORDER BY norad_id"


def globe_rows(conn: psycopg.Connection) -> list[dict]:
    """Every object on the globe (both groups), read in one database snapshot."""
    with conn.transaction():
        conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        return [
            row
            for regimes in SNAPSHOT_GROUPS.values()
            for row in conn.execute(GROUP_ROWS_SQL, (list(regimes),)).fetchall()
        ]


def load_index(store: SnapshotStore) -> dict | None:
    data = store.get(INDEX_KEY)
    if data is None:
        return None
    try:
        index = json.loads(data)
    except ValueError:
        return None
    return index if isinstance(index, dict) and isinstance(index.get("days"), list) else None


def _entries_from_files(store: SnapshotStore) -> list[dict]:
    entries = []
    for key in store.keys(DAYS_PREFIX):
        data = store.get(key)
        if data is None:
            continue
        try:
            entries.append(index_entry(read_header(data)))
        except (ValueError, OSError, KeyError):
            log.warning("skipping unreadable crowding day file %s", key)
    return entries


def update_index(conn: psycopg.Connection, store: SnapshotStore, written: Iterable[dict]) -> dict:
    """Adds or replaces the entries for the days just written; rebuilds the day list from the day
    files' headers when the index is missing or unreadable. `reentries` is recomputed every time,
    so decay dates that SATCAT publishes late flow in by themselves."""
    index = load_index(store)
    by_day = {e["day"]: e for e in (index["days"] if index else _entries_from_files(store))}
    for entry in written:
        by_day[entry["day"]] = entry
    days = [by_day[d] for d in sorted(by_day)]
    reentries = {
        str(r["norad_id"]): r["decay_date"].isoformat()
        for r in conn.execute(REENTRIES_SQL, (HISTORY_START,)).fetchall()
    }
    body = {
        "version": 1, "history_start": HISTORY_START.isoformat(), "days": days,
        "latest": {"day": days[-1]["day"], "generation": days[-1]["generation"]} if days else None,
        "reentries": reentries,
    }
    store.put(INDEX_KEY, json.dumps(body, separators=(",", ":")).encode())
    return body


def publish_day(conn: psycopg.Connection, store: SnapshotStore, now: datetime) -> int:
    """Writes (or overwrites) the file for `now`'s UTC day and updates the index. With no element
    sets at all it writes nothing, like the globe."""
    rows = globe_rows(conn)
    if not rows:
        log.warning("nothing to publish: no element sets in the database; crowding is unchanged")
        return 0
    pointer = read_pointer(store)
    day = now.astimezone(UTC).date()
    data = pack_day(rows, day=day, generated_at=now,
                    generation=pointer["generation"] if pointer else None, source="live")
    store.put(day_key(day), data)
    header = read_header(data)
    update_index(conn, store, [index_entry(header)])
    return header["count"]


def run_publish_crowding(
    conn: psycopg.Connection, store: SnapshotStore, database_url: str,
    now: datetime | None = None,
) -> int:
    """Publishes today's crowding file under the globe lock, so a deploy-time publish, a scheduled
    ingest and the backfill never interleave their index updates."""
    now = now or datetime.now(UTC)
    with run_log(conn, "publish_crowding") as run, advisory_lock(database_url, GLOBE_LOCK):
        run.source = "database"
        run.rows = publish_day(conn, store, now)
    return run.rows
