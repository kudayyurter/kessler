import itertools
import json
from datetime import UTC, date, datetime

from app.crowding.backfill import run_backfill_crowding
from app.crowding.format import INDEX_KEY, day_key, read_header, unpack_day
from app.history.archive import archive_key, encode_records
from tests.factories import insert_object

TODAY = datetime(2026, 9, 28, 9, 0, tzinfo=UTC)


def omm(norad_id: int, epoch: str, mm: float = 15.5, e: float = 0.001, i: float = 53.0) -> dict:
    return {"NORAD_CAT_ID": str(norad_id), "EPOCH": epoch, "MEAN_MOTION": str(mm),
            "ECCENTRICITY": str(e), "INCLINATION": str(i), "OBJECT_NAME": f"OBJ {norad_id}"}


def archive(store, at: datetime, run_id: int, records: list[dict]) -> None:
    store.put(archive_key(at, "spacetrack", run_id), encode_records(records))


def seed(conn, store) -> None:
    insert_object(conn, 10)                                       # plain LEO payload
    insert_object(conn, 11, decay_date=date(2026, 9, 26))         # re-enters on 09-26
    insert_object(conn, 12, regime="OTHER")                       # beyond Earth orbit
    insert_object(conn, 13)                                       # its only element set is stale
    insert_object(conn, 15, object_type="DEB", owner="PRC")       # lowers its orbit on 09-26
    archive(store, datetime(2026, 9, 25, 6, 41, 32, tzinfo=UTC), 12, [
        omm(10, "2026-09-25T01:00:00"), omm(11, "2026-09-25T02:00:00"),
        omm(12, "2026-09-25T03:00:00"), omm(13, "2026-08-01T00:00:00"),
        omm(14, "2026-09-25T04:00:00"),                           # not in the catalogue
        omm(15, "2026-09-25T05:00:00", mm=15.06),
        {"NORAD_CAT_ID": "16", "EPOCH": "garbage"},               # malformed
    ])
    archive(store, datetime(2026, 9, 25, 12, 41, 32, tzinfo=UTC), 13, [
        omm(10, "2026-09-25T10:00:00"),
    ])
    archive(store, datetime(2026, 9, 26, 0, 41, 32, tzinfo=UTC), 16, [
        omm(15, "2026-09-25T22:00:00", mm=15.3),
    ])
    # 2026-09-27 has no archive files; 2026-09-28 is today (not backfilled).


def ids(store, day: date) -> list[int]:
    return list(itertools.accumulate(unpack_day(store.get(day_key(day)))[1]["norad_delta"]))


def test_rebuilds_each_archived_day_with_the_globe_population(conn, store, migrated):
    seed(conn, store)
    assert run_backfill_crowding(conn, store, migrated, now=TODAY) == 2
    assert ids(store, date(2026, 9, 25)) == [10, 11, 15]
    assert ids(store, date(2026, 9, 26)) == [10, 15]          # 11 re-entered that day
    assert store.get(day_key(date(2026, 9, 27))) is None     # no archive files that day
    assert store.get(day_key(date(2026, 9, 28))) is None     # today is the live publisher's
    h25 = read_header(store.get(day_key(date(2026, 9, 25))))
    assert (h25["source"], h25["generation"], h25["generated_at"]) == (
        "archive", None, "2026-09-25T12:41:32+00:00")
    sma = {d: unpack_day(store.get(day_key(d)))[1]["sma_dkm"][-1]
           for d in (date(2026, 9, 25), date(2026, 9, 26))}
    assert sma[date(2026, 9, 25)] > sma[date(2026, 9, 26)]   # 15 moved down (15.06 → 15.3 rev/day)
    index = json.loads(store.get(INDEX_KEY))
    assert [d["day"] for d in index["days"]] == ["2026-09-25", "2026-09-26"]
    assert index["latest"] == {"day": "2026-09-26", "generation": None}
    assert index["reentries"] == {"11": "2026-09-26"}
    run = conn.execute("SELECT status, rows, source FROM ingest_runs WHERE job = 'backfill_crowding'").fetchone()
    assert (run["status"], run["rows"], run["source"]) == ("ok", 2, "archive")


def test_never_overwrites_an_existing_day_and_is_idempotent(conn, store, migrated):
    seed(conn, store)
    store.put(day_key(date(2026, 9, 26)), b"live file")
    assert run_backfill_crowding(conn, store, migrated, now=TODAY) == 1
    assert store.get(day_key(date(2026, 9, 26))) == b"live file"
    assert run_backfill_crowding(conn, store, migrated, now=TODAY) == 0


def test_an_empty_archive_writes_nothing(conn, store, migrated):
    assert run_backfill_crowding(conn, store, migrated, now=TODAY) == 0
    assert store.get(INDEX_KEY) is None
