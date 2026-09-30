import json
from datetime import UTC, date, datetime

import pytest

from app.crowding.format import INDEX_KEY, day_key, pack_day

T = datetime(2026, 9, 28, 12, 41, 32, tzinfo=UTC)
IMMUTABLE = "public, max-age=31536000, immutable"
LATEST = "public, max-age=60, s-maxage=300"


def put_day(store, day: date) -> bytes:
    data = pack_day([{"norad_id": 1, "owner": "US", "object_type": "PAY", "mean_motion": 15.5,
                      "eccentricity": 0.001, "inclination": 53.0}],
                    day=day, generated_at=T, generation=None, source="live")
    store.put(day_key(day), data)
    return data


@pytest.fixture
def crowding(store):
    days = {d: put_day(store, d) for d in (date(2026, 9, 27), date(2026, 9, 28))}
    store.put(INDEX_KEY, json.dumps({"version": 1, "history_start": "2026-09-25", "days": [],
                                     "latest": {"day": "2026-09-28", "generation": None},
                                     "reentries": {}}).encode())
    return days


def test_index_is_404_before_the_first_publication(client):
    r = client.get("/api/crowding/index")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


def test_index_is_served_with_a_short_cache(client, crowding):
    r = client.get("/api/crowding/index")
    assert r.status_code == 200
    assert r.json()["latest"] == {"day": "2026-09-28", "generation": None}
    assert r.headers["cache-control"] == "public, max-age=60, s-maxage=60"


def test_a_past_day_is_immutable_and_supports_etags(client, crowding):
    r = client.get("/api/crowding/day/2026-09-27")
    assert r.status_code == 200
    assert r.content == crowding[date(2026, 9, 27)]
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["cache-control"] == IMMUTABLE
    again = client.get("/api/crowding/day/2026-09-27", headers={"If-None-Match": r.headers["etag"]})
    assert again.status_code == 304


def test_the_latest_day_has_a_short_cache_and_accepts_gen(client, crowding):
    r = client.get("/api/crowding/day/2026-09-28?gen=20260928T124132Z-r37")
    assert r.status_code == 200
    assert r.headers["cache-control"] == LATEST


def test_without_an_index_every_day_gets_the_short_cache(client, store):
    put_day(store, date(2026, 9, 27))
    assert client.get("/api/crowding/day/2026-09-27").headers["cache-control"] == LATEST


def test_a_missing_day_is_404(client, crowding):
    r = client.get("/api/crowding/day/2026-09-20")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("bad", ["2026-02-30", "20260928", "2026-9-28", "latest",
                                 "２０２６-09-28", "2026-09-28x"])
def test_a_malformed_or_impossible_date_is_400(client, crowding, bad):
    r = client.get(f"/api/crowding/day/{bad}")
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_request"


def test_a_malformed_gen_is_rejected(client, crowding):
    assert client.get("/api/crowding/day/2026-09-28?gen=../x").status_code == 422
