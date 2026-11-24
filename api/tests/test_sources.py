import httpx
import pytest
import respx

from app.ingest.sources import (
    CELESTRAK_GP_ACTIVE_URL,
    CELESTRAK_SATCAT_URL,
    SPACETRACK_GP_URL,
    SPACETRACK_LOGIN_URL,
    CelesTrakClient,
    SourceError,
    SpaceTrackClient,
)

NO_SLEEP = lambda _s: None  # noqa: E731
SATCAT_HEAD = "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID\nISS (ZARYA),1998-067A,25544\n"


@respx.mock
def test_celestrak_satcat_ok():
    respx.get(CELESTRAK_SATCAT_URL).mock(return_value=httpx.Response(200, text=SATCAT_HEAD))
    with httpx.Client() as http:
        assert CelesTrakClient(http, sleep=NO_SLEEP).satcat_csv() == SATCAT_HEAD


@respx.mock
def test_celestrak_rejects_html_error_page():
    respx.get(CELESTRAK_SATCAT_URL).mock(
        return_value=httpx.Response(200, text="<html>Service unavailable</html>")
    )
    with httpx.Client() as http, pytest.raises(SourceError, match="unexpected"):
        CelesTrakClient(http, sleep=NO_SLEEP).satcat_csv()


@respx.mock
def test_celestrak_retries_server_errors_then_succeeds():
    route = respx.get(CELESTRAK_GP_ACTIVE_URL)
    route.side_effect = [
        httpx.Response(503),
        httpx.Response(200, text="OBJECT_NAME,OBJECT_ID,EPOCH\n"),
    ]
    with httpx.Client() as http:
        assert CelesTrakClient(http, sleep=NO_SLEEP).gp_active_csv().startswith("OBJECT_NAME")
    assert route.call_count == 2


@respx.mock
def test_celestrak_gives_up_after_three_attempts():
    respx.get(CELESTRAK_SATCAT_URL).mock(return_value=httpx.Response(500))
    with httpx.Client() as http, pytest.raises(SourceError, match="HTTP 500"):
        CelesTrakClient(http, sleep=NO_SLEEP).satcat_csv()


@respx.mock
def test_spacetrack_logs_in_then_fetches_gp():
    login = respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, json=[{"NORAD_CAT_ID": "25544"}])
    )
    with httpx.Client() as http:
        data = SpaceTrackClient(http, "me@example.com", "pw", sleep=NO_SLEEP).gp_all_on_orbit()
    assert data == [{"NORAD_CAT_ID": "25544"}]
    assert b"identity=me%40example.com" in login.calls[0].request.content


@respx.mock
def test_spacetrack_login_failure_raises():
    respx.post(SPACETRACK_LOGIN_URL).mock(
        return_value=httpx.Response(200, json={"Login": "Failed"})
    )
    with httpx.Client() as http, pytest.raises(SourceError, match="login failed"):
        SpaceTrackClient(http, "me", "bad", sleep=NO_SLEEP).gp_all_on_orbit()


@respx.mock
def test_spacetrack_non_list_payload_raises():
    respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, json={"error": "query limit"})
    )
    with httpx.Client() as http, pytest.raises(SourceError, match="unexpected"):
        SpaceTrackClient(http, "me", "pw", sleep=NO_SLEEP).gp_all_on_orbit()


class FakeClock:
    """Each read advances time by `step` seconds."""

    def __init__(self, step: float):
        self.now = 0.0
        self.step = step

    def __call__(self) -> float:
        self.now += self.step
        return self.now


class IterStream(httpx.SyncByteStream):
    def __init__(self, chunks: list[bytes]):
        self.chunks = chunks

    def __iter__(self):
        yield from self.chunks


def slow_body(chunks: int = 5) -> httpx.Response:
    return httpx.Response(200, stream=IterStream([b"OBJECT_NAME,X\n"] * chunks))


@respx.mock
def test_celestrak_slow_download_hits_the_deadline_and_fails_cleanly():
    # 2026-11-21: satcat.csv trickled in so slowly that the job ran into the 10-minute
    # Lambda timeout. Each attempt now has a total time budget.
    route = respx.get(CELESTRAK_SATCAT_URL)
    route.side_effect = lambda _req: slow_body()
    client = CelesTrakClient(httpx.Client(), sleep=NO_SLEEP, clock=FakeClock(step=100))
    with pytest.raises(SourceError, match="deadline"):
        client.satcat_csv()
    assert route.call_count == 3


@respx.mock
def test_celestrak_retries_after_a_slow_download_then_succeeds():
    route = respx.get(CELESTRAK_SATCAT_URL)
    route.side_effect = [slow_body(chunks=50), httpx.Response(200, text=SATCAT_HEAD)]
    client = CelesTrakClient(httpx.Client(), sleep=NO_SLEEP, clock=FakeClock(step=10))
    assert client.satcat_csv() == SATCAT_HEAD
    assert route.call_count == 2


@respx.mock
def test_spacetrack_gp_json_still_parses_through_the_streamed_read():
    respx.post(SPACETRACK_LOGIN_URL).mock(return_value=httpx.Response(200, text='""'))
    respx.get(SPACETRACK_GP_URL).mock(
        return_value=httpx.Response(200, json=[{"NORAD_CAT_ID": "25544"}])
    )
    client = SpaceTrackClient(httpx.Client(), "me", "pw", sleep=NO_SLEEP, clock=FakeClock(step=1))
    assert client.gp_all_on_orbit() == [{"NORAD_CAT_ID": "25544"}]
