import re

import psycopg

from app.domain.orbits import OPS_STATUS_LABELS
from app.errors import ApiError

# GP columns selected under their own names. The element set's inclination is aliased
# g_inclination because objects.inclination (from SATCAT) has the same name.
ELEMENT_KEYS = (
    "epoch", "mean_motion", "eccentricity", "raan", "arg_pericenter",
    "mean_anomaly", "bstar", "mean_motion_dot", "mean_motion_ddot", "source",
)
INTERNAL_KEYS = {"g_inclination", "g_norad", "event_name", "event_date", *ELEMENT_KEYS}

SEPARATORS = re.compile(r"[-_\s]+")


def normalise_name(text: str) -> str:
    """Runs of hyphens, underscores and whitespace become one space, so "starlink 1007",
    "starlink-1007" and "STARLINK_1007" all match STARLINK-1007."""
    return SEPARATORS.sub(" ", text).strip()


def escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def get_object(conn: psycopg.Connection, norad_id: int) -> dict | None:
    row = conn.execute(
        """
        SELECT o.*, ow.name AS owner_name, ow.flag_emoji, ls.name AS launch_site_name,
               e.name AS event_name, e.event_date AS event_date,
               g.epoch, g.mean_motion, g.eccentricity, g.inclination AS g_inclination, g.raan,
               g.arg_pericenter, g.mean_anomaly, g.bstar, g.mean_motion_dot, g.mean_motion_ddot,
               g.source, g.norad_id AS g_norad
        FROM objects o
        JOIN owners ow ON ow.code = o.owner
        LEFT JOIN launch_sites ls ON ls.code = o.launch_site
        LEFT JOIN breakup_events e ON e.id = o.event_id
        LEFT JOIN gp_elements g ON g.norad_id = o.norad_id
        WHERE o.norad_id = %s
        """,
        (norad_id,),
    ).fetchone()
    if row is None:
        return None
    elements = None
    if row["g_norad"] is not None:
        elements = {c: row[c] for c in ELEMENT_KEYS}
        elements["inclination"] = row["g_inclination"]
    obj = {k: v for k, v in row.items() if k not in INTERNAL_KEYS}
    obj["ops_status_label"] = OPS_STATUS_LABELS.get(row["ops_status"] or "")
    obj["event"] = (
        {"id": row["event_id"], "name": row["event_name"], "event_date": row["event_date"]}
        if row["event_id"] else None
    )
    obj["elements"] = elements
    return obj


def search_objects(conn: psycopg.Connection, q: str, limit: int = 20) -> list[dict]:
    q = q.strip()
    if any(ord(c) < 32 for c in q):
        raise ApiError(422, "invalid_query", "search text contains invalid control characters")
    base = (
        "SELECT norad_id, name, cospar_id, object_type, owner, regime, "
        "(decay_date IS NOT NULL) AS decayed FROM objects "
    )
    if q.isascii() and q.isdigit() and len(q) <= 9:
        return conn.execute(base + "WHERE norad_id = %s", (int(q),)).fetchall()
    if len(q) < 2:
        raise ApiError(422, "invalid_query", "search text must be at least 2 characters")
    name_q = normalise_name(q)
    # A query of only separators normalises to nothing; don't let it match every name.
    name_clause = (
        "regexp_replace(name, '[-_[:space:]]+', ' ', 'g') ILIKE %(p)s ESCAPE '\\' OR "
        if len(name_q) >= 2
        else ""
    )
    return conn.execute(
        base
        + "WHERE "
        + name_clause
        + "cospar_id ILIKE %(c)s ESCAPE '\\' "
        "ORDER BY (decay_date IS NULL) DESC, norad_id LIMIT %(limit)s",
        {"p": f"%{escape_like(name_q)}%", "c": f"{escape_like(q.upper())}%", "limit": limit},
    ).fetchall()
