"""The visit counter: aggregate counts only, no personal data, team and robots not counted."""

import asyncio

import pytest
from fastapi.testclient import TestClient

TOKEN = "visits-team-token"
CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
FIREFOX = "Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0"


@pytest.fixture
def counter(temp_db):
    from visits import VisitCounter
    return VisitCounter()


def test_a_visitor_is_counted_once_per_visit_and_once_per_day(counter):
    t0 = 1_790_000_000.0
    assert counter.record("1.2.3.4", CHROME, "main", ts=t0)["newVisitor"] is True
    assert counter.record("1.2.3.4", CHROME, "main", ts=t0 + 60)["counted"] is False      # same visit
    again = counter.record("1.2.3.4", CHROME, "story:blizzard", ts=t0 + 31 * 60)          # a new visit
    assert again["counted"] is True and again["newVisitor"] is False
    assert counter.record("1.2.3.4", FIREFOX, "main", ts=t0 + 120)["newVisitor"] is True  # another browser
    assert counter.record("5.6.7.8", CHROME, "main", ts=t0 + 180)["newVisitor"] is True   # another person


def test_robots_previews_and_headless_browsers_are_not_counted(counter):
    for ua in ("", "Googlebot/2.1", "WhatsApp link preview", "Mozilla/5.0 HeadlessChrome/128.0", "curl/8.4"):
        assert counter.record("1.2.3.4", ua, "main")["counted"] is False


def test_unknown_entries_are_recorded_as_main(counter):
    from visits import clean_entry
    assert clean_entry("story:fuel") == "story:fuel" and clean_entry("module:logistics") == "module:logistics"
    assert clean_entry("story:volcano") == "main" and clean_entry("<script>") == "main" and clean_entry(None) == "main"


def test_nothing_personal_is_stored(counter):
    import db
    counter.record("203.0.113.9", CHROME, "story:generator")
    with db.connect() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM visit_counts")]
    assert set(rows[0]) == {"day", "hour", "entry", "visits", "visitors"}
    flat = repr(rows)
    assert "203.0.113.9" not in flat and "Chrome" not in flat


def test_summary_totals_days_hours_and_entries(counter):
    from visits import ist_now
    counter.record("1.1.1.1", CHROME, "main")
    counter.record("2.2.2.2", CHROME, "story:blizzard")
    counter.record("3.3.3.3", FIREFOX, "story:blizzard")
    s = counter.summary(14)
    assert s["totals"] == {"visits": 3, "visitors": 3}
    assert s["byDay"][0]["day"] == ist_now().strftime("%Y-%m-%d")
    assert s["entries"][0] == {"entry": "story:blizzard", "visits": 2}
    assert sum(h["visits"] for h in s["today"]["hours"]) == 3 and len(s["today"]["hours"]) == 24
    assert s["lastVisitHour"]["hour"] == ist_now().hour


def test_a_new_day_forgets_every_visitor_and_prunes_old_counts(counter):
    import db
    with db.connect() as conn:
        conn.execute("INSERT INTO visit_counts VALUES ('2000-01-01', 3, 'main', 5, 5)")
    t0 = 1_790_000_000.0
    counter.record("1.2.3.4", CHROME, "main", ts=t0)
    salt = counter._salt
    nxt = counter.record("1.2.3.4", CHROME, "main", ts=t0 + 86_400)
    assert nxt["newVisitor"] is True and counter._salt != salt
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM visit_counts WHERE day = '2000-01-01'").fetchone()[0] == 0


@pytest.fixture
def api(temp_db, monkeypatch):
    import visits

    import unified_backend as ub
    from station_store import StationStore

    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", TOKEN)

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=50))
    monkeypatch.setattr(ub, "VISITS", visits.VisitCounter())
    with TestClient(ub.app) as c:
        yield c


def test_the_beacon_is_public_sets_no_cookie_and_skips_the_team(api):
    r = api.post("/api/visit", json={"entry": "story:fuel"}, headers={"User-Agent": CHROME})
    assert r.status_code == 200 and r.json() == {"counted": True}
    assert "set-cookie" not in r.headers
    team = api.post("/api/visit", json={"entry": "main"}, headers={"User-Agent": FIREFOX, "X-Admin-Token": TOKEN})
    assert team.json() == {"counted": False}
    assert api.post("/api/visit", json={"entry": "x" * 65}, headers={"User-Agent": CHROME}).status_code == 422


def test_only_the_team_can_read_the_counts(api):
    api.post("/api/visit", json={"entry": "main"}, headers={"User-Agent": CHROME})
    assert api.get("/api/admin/visits").status_code == 401
    body = api.get("/api/admin/visits", headers={"X-Admin-Token": TOKEN}).json()
    assert body["totals"]["visits"] == 1 and body["entries"] == [{"entry": "main", "visits": 1}]
