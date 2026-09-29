import itertools
import json
from datetime import UTC, date, datetime, timedelta

import pytest

from app.crowding.format import INDEX_KEY, day_key, read_header, unpack_day
from app.crowding.publish import publish_day, run_publish_crowding
from app.ingest.snapshot import LocalSnapshotStore, publish_generation
from tests.factories import add_gp, insert_object

T = datetime(2026, 9, 28, 12, 41, 32, tzinfo=UTC)
GEN = "20260928T124132Z-r37"


@pytest.fixture
def globe(world, store):
    # world: 1 = LEO payload (US), 2 and 3 re-entered long ago, 4 = GEO payload (US).
    add_gp(world, 1, 2, 4)
    publish_generation(world, store, T, 37)
    return world


def index(store) -> dict:
    return json.loads(store.get(INDEX_KEY))


def test_publishes_todays_file_and_the_index(globe, store, migrated):
    assert run_publish_crowding(globe, store, migrated, now=T) == 2
    header, cols = unpack_day(store.get(day_key(date(2026, 9, 28))))
    assert (header["day"], header["source"], header["generation"], header["count"]) == (
        "2026-09-28", "live", GEN, 2)
    assert list(itertools.accumulate(cols["norad_delta"])) == [1, 4]  # 2 has re-entered
    entry = {"day": "2026-09-28", "generated_at": T.isoformat(), "count": 2, "source": "live",
             "generation": GEN}
    assert index(store) == {"version": 1, "history_start": "2026-09-25", "days": [entry],
                            "latest": {"day": "2026-09-28", "generation": GEN}, "reentries": {}}
    run = globe.execute("SELECT status, rows FROM ingest_runs WHERE job = 'publish_crowding'").fetchone()
    assert (run["status"], run["rows"]) == ("ok", 2)


def test_a_later_run_the_same_day_overwrites_today_only(globe, store):
    publish_day(globe, store, T - timedelta(days=1))
    yesterday = store.get(day_key(date(2026, 9, 27)))
    publish_day(globe, store, T)
    publish_day(globe, store, T + timedelta(hours=6))
    assert store.get(day_key(date(2026, 9, 27))) == yesterday
    assert read_header(store.get(day_key(date(2026, 9, 28))))["generated_at"] == (
        T + timedelta(hours=6)).isoformat()
    days = index(store)["days"]
    assert [d["day"] for d in days] == ["2026-09-27", "2026-09-28"]
    assert days[1]["generated_at"] == (T + timedelta(hours=6)).isoformat()


def test_reentries_since_history_start_come_from_objects(globe, store):
    insert_object(globe, 50, decay_date=date(2026, 9, 26))
    insert_object(globe, 51, decay_date=date(2026, 9, 24))
    publish_day(globe, store, T)
    assert index(store)["reentries"] == {"50": "2026-09-26"}


def test_a_missing_or_corrupt_index_is_rebuilt_from_the_day_files(globe, store):
    publish_day(globe, store, T - timedelta(days=1))
    store.put(INDEX_KEY, b"{not json")
    publish_day(globe, store, T)
    assert [d["day"] for d in index(store)["days"]] == ["2026-09-27", "2026-09-28"]
    store.delete(INDEX_KEY)
    publish_day(globe, store, T)
    assert [d["day"] for d in index(store)["days"]] == ["2026-09-27", "2026-09-28"]


def test_an_empty_database_writes_nothing(conn, store):
    assert publish_day(conn, store, T) == 0
    assert store.get(day_key(date(2026, 9, 28))) is None
    assert store.get(INDEX_KEY) is None


class CrowdingWriteFails(LocalSnapshotStore):
    def put(self, key: str, data: bytes) -> None:
        if key.startswith("crowding/"):
            raise OSError("disk full")
        super().put(key, data)


def test_a_failed_write_marks_the_run_failed(globe, migrated, tmp_path):
    failing = CrowdingWriteFails(tmp_path / "failing")
    with pytest.raises(OSError, match="disk full"):
        run_publish_crowding(globe, failing, migrated, now=T)
    run = globe.execute("SELECT status FROM ingest_runs WHERE job = 'publish_crowding'").fetchone()
    assert run["status"] == "failed"
