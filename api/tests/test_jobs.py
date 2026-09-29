import httpx
import pytest
import respx

from app.config import Settings
from app.ingest.snapshot import LocalSnapshotStore, read_pointer
from app.ingest.sources import (
    CELESTRAK_GP_ACTIVE_URL,
    CELESTRAK_SATCAT_URL,
    SPACETRACK_GP_URL,
    SPACETRACK_LOGIN_URL,
)
from app.jobs import run_job
from tests.conftest import FIXTURES


@respx.mock
def test_run_all_end_to_end(conn, migrated, tmp_path):
    respx.get(CELESTRAK_SATCAT_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "satcat_sample.csv").read_text())
    )
    respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "gp_spacetrack_sample.json").read_text())
    )
    respx.get(CELESTRAK_GP_ACTIVE_URL).mock(return_value=httpx.Response(500))
    settings = Settings(
        database_url=migrated, spacetrack_user="u", spacetrack_pass="p",
        min_satcat_rows=10, min_gp_rows_spacetrack=3,
    )
    store = LocalSnapshotStore(tmp_path)
    with httpx.Client() as http:
        result = run_job("all", settings, store=store, http=http)
    assert result == {"ingest_satcat": 20, "rebuild_stats": result["rebuild_stats"],
                      "ingest_gp": 3, "archived_gp": 4, "publish_crowding": 3}
    assert result["rebuild_stats"] > 0
    assert read_pointer(store) is not None


def test_unknown_job_is_rejected(migrated):
    with pytest.raises(ValueError, match="unknown job"):
        run_job("bogus", Settings(database_url=migrated))


@respx.mock
def test_publish_globe_republishes_from_the_database(conn, migrated, tmp_path):
    respx.get(CELESTRAK_SATCAT_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "satcat_sample.csv").read_text())
    )
    respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "gp_spacetrack_sample.json").read_text())
    )
    respx.get(CELESTRAK_GP_ACTIVE_URL).mock(return_value=httpx.Response(500))
    settings = Settings(
        database_url=migrated, spacetrack_user="u", spacetrack_pass="p",
        min_satcat_rows=10, min_gp_rows_spacetrack=3,
    )
    store = LocalSnapshotStore(tmp_path)
    with httpx.Client() as http:
        run_job("all", settings, store=store, http=http)
        before = read_pointer(store)["generation"]
        gp_calls = respx.calls.call_count
        result = run_job("publish-globe", settings, store=store, http=http)
    assert result == {"publish_globe": 3, "publish_crowding": 3}
    assert read_pointer(store)["generation"] != before
    assert respx.calls.call_count == gp_calls  # no Space-Track or CelesTrak request


class _CrowdingWriteFails(LocalSnapshotStore):
    def put(self, key: str, data: bytes) -> None:
        if key.startswith("crowding/"):
            raise OSError("disk full")
        super().put(key, data)


@respx.mock
def test_ingest_gp_stays_ok_when_the_crowding_step_fails(conn, migrated, tmp_path):
    respx.get(CELESTRAK_SATCAT_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "satcat_sample.csv").read_text())
    )
    respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, text=(FIXTURES / "gp_spacetrack_sample.json").read_text())
    )
    respx.get(CELESTRAK_GP_ACTIVE_URL).mock(return_value=httpx.Response(500))
    settings = Settings(
        database_url=migrated, spacetrack_user="u", spacetrack_pass="p",
        min_satcat_rows=10, min_gp_rows_spacetrack=3,
    )
    store = _CrowdingWriteFails(tmp_path)
    with httpx.Client() as http:
        run_job("ingest-satcat", settings, store=store, http=http)
        with pytest.raises(OSError, match="disk full"):
            run_job("ingest-gp", settings, store=store, http=http)
    runs = {r["job"]: r["status"] for r in conn.execute("SELECT job, status FROM ingest_runs").fetchall()}
    assert runs["ingest_gp"] == "ok"
    assert runs["publish_crowding"] == "failed"
    assert read_pointer(store) is not None


def test_backfill_crowding_job_runs(conn, migrated, tmp_path):
    result = run_job("backfill-crowding", Settings(database_url=migrated),
                     store=LocalSnapshotStore(tmp_path))
    assert result == {"backfill_crowding": 0}
