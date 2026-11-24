import time
from collections.abc import Callable

import httpx

USER_AGENT = "kessler/0.1 (+https://kessler.kudayyurter.dev)"

CELESTRAK_SATCAT_URL = "https://celestrak.org/pub/satcat.csv"
CELESTRAK_GP_ACTIVE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv"
SPACETRACK_LOGIN_URL = "https://www.space-track.org/ajaxauth/login"
# All on-orbit objects with an element set newer than 30 days: Space-Track's recommended
# bulk query. One request; never query per object.
SPACETRACK_GP_URL = (
    "https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val"
    "/epoch/%3Enow-30/orderby/norad_cat_id/format/json"
)

CSV_HEADER_PREFIX = "OBJECT_NAME,"
ATTEMPTS = 3
# Total time budget for one attempt, from sending the request to the last byte. httpx's own
# timeout only bounds each wait for the next packet, so a slow but steady download can run
# forever: on 2026-11-21 CelesTrak's satcat.csv did, and the job hit the 10-minute Lambda
# timeout. 3 attempts x 120 s still leave time for the database work.
ATTEMPT_DEADLINE_S = 120.0


class SourceError(RuntimeError):
    """An upstream data source failed or returned something we refuse to ingest."""


def _fetch(
    http: httpx.Client, method: str, url: str, clock: Callable[[], float], **kwargs
) -> httpx.Response:
    """Send one request and read the body, giving up after ATTEMPT_DEADLINE_S."""
    start = clock()
    with http.stream(method, url, **kwargs) as response:
        chunks = []
        for chunk in response.iter_bytes():
            chunks.append(chunk)
            if clock() - start > ATTEMPT_DEADLINE_S:
                raise httpx.ReadTimeout(
                    f"download exceeded the {ATTEMPT_DEADLINE_S:.0f} s deadline",
                    request=response.request,
                )
        content_type = response.headers.get("content-type")
        return httpx.Response(
            response.status_code,
            content=b"".join(chunks),
            headers={"content-type": content_type} if content_type else None,
            request=response.request,
        )


def _request(
    send: Callable[[], httpx.Response], what: str, sleep: Callable[[float], None]
) -> httpx.Response:
    last = ""
    for attempt in range(ATTEMPTS):
        try:
            response = send()
        except httpx.TransportError as exc:
            last = f"{type(exc).__name__}: {exc}"
        else:
            if response.status_code < 500:
                if response.status_code >= 400:
                    raise SourceError(f"{what}: HTTP {response.status_code}")
                return response
            last = f"HTTP {response.status_code}"
        if attempt < ATTEMPTS - 1:
            sleep(2.0 * (attempt + 1))
    raise SourceError(f"{what}: {last} after {ATTEMPTS} attempts")


class CelesTrakClient:
    def __init__(
        self,
        http: httpx.Client,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.http = http
        self.sleep = sleep
        self.clock = clock

    def _csv(self, url: str, what: str) -> str:
        text = _request(lambda: _fetch(self.http, "GET", url, self.clock), what, self.sleep).text
        if not text.startswith(CSV_HEADER_PREFIX):
            raise SourceError(f"{what}: unexpected response starting {text[:80]!r}")
        return text

    def satcat_csv(self) -> str:
        return self._csv(CELESTRAK_SATCAT_URL, "CelesTrak SATCAT")

    def gp_active_csv(self) -> str:
        return self._csv(CELESTRAK_GP_ACTIVE_URL, "CelesTrak GP active")


class SpaceTrackClient:
    def __init__(
        self,
        http: httpx.Client,
        user: str,
        password: str,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.http = http
        self.user = user
        self.password = password
        self.sleep = sleep
        self.clock = clock

    def gp_all_on_orbit(self) -> list[dict]:
        login = _request(
            lambda: _fetch(
                self.http,
                "POST",
                SPACETRACK_LOGIN_URL,
                self.clock,
                data={"identity": self.user, "password": self.password},
            ),
            "Space-Track login",
            self.sleep,
        )
        if "Failed" in login.text:
            raise SourceError("Space-Track login failed (check SPACETRACK_USER/SPACETRACK_PASS)")
        response = _request(
            lambda: _fetch(self.http, "GET", SPACETRACK_GP_URL, self.clock),
            "Space-Track GP",
            self.sleep,
        )
        try:
            data = response.json()
        except ValueError as exc:
            raise SourceError("Space-Track GP: response was not JSON") from exc
        if not isinstance(data, list):
            raise SourceError(f"Space-Track GP: unexpected payload {str(data)[:200]}")
        return data
