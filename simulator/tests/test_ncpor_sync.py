"""NCPOR live pages: parser against saved copies, plausibility checks, graceful failure,
the scheduled sync with back-off, and the freshness status.

The fixtures are real copies of https://data.ncpor.res.in/{maitri,bharati}/live (saved
2026-10-03). If NCPOR changes its page, re-save them and these tests show what changed,
instead of the dashboard silently storing bad data.
"""

from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "ncpor"
SERIES = {"Temperature", "Wind Speed", "Air Pressure", "Relative Humidity"}


def page(station: str) -> str:
    return (FIXTURES / f"{station}_live.html").read_text(encoding="utf-8")


@pytest.mark.parametrize("station", ["maitri", "bharati"])
def test_the_saved_pages_parse_into_four_hourly_series(station):
    from ncpor_ingestor import page_wind_unit, parse_canvasjs_series
    series = parse_canvasjs_series(page(station))
    assert set(series) == SERIES
    for name, points in series.items():
        assert len(points) == 25, name
        times = [t for t, _ in points]
        assert times == sorted(times)
        assert {b - a for a, b in zip(times, times[1:], strict=False)} == {3_600_000}      # hourly
    assert page_wind_unit(page(station)) == "m/s"
    temps = [v for _, v in series["Temperature"]]
    assert all(-40 < v < 5 for v in temps)          # spring at the coast: plausibly cold


def test_plausibility_flags_out_of_range_values_and_spikes_but_not_the_recovery():
    from ncpor_ingestor import check_plausibility
    h = 3_600_000
    out = check_plausibility("wind_speed", [(0, 5.0), (h, 6.0), (2 * h, 45.0), (3 * h, 7.0), (4 * h, 99.0)])
    reasons = [r for _, _, r in out]
    assert reasons[0] is None and reasons[1] is None
    assert "jumped" in reasons[2]                   # 6 → 45 in an hour
    assert reasons[3] is None                       # back to 7: compared with the last good value (6)
    assert "outside the plausible range" in reasons[4]
    # A longer gap allows a larger change.
    assert check_plausibility("temperature", [(0, -20.0), (5 * h, -2.0)])[1][2] is None


@pytest.fixture
def fake_page(monkeypatch, temp_db):
    """ncpor_ingestor.fetch_live_page returns whatever the test puts in pages[station]."""
    import ncpor_ingestor
    pages = {}

    def fetch(url):
        station = "maitri" if "maitri" in url else "bharati"
        value = pages.get(station)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(ncpor_ingestor, "fetch_live_page", fetch)
    return pages


def _rows(station, quality=None):
    import db
    q = "SELECT COUNT(*) FROM observations WHERE station_id = ? AND dataset = 'NCPOR-AWS-Live'"
    args = [station]
    if quality:
        q += " AND quality = ?"
        args.append(quality)
    with db.connect() as conn:
        return conn.execute(q, args).fetchone()[0]


def test_a_good_page_is_stored_with_its_unit_and_newest_time(fake_page):
    from ncpor_ingestor import ingest_live_station
    fake_page["maitri"] = page("maitri")
    r = ingest_live_station("maitri")
    assert r["status"] == "success" and r["records_ingested"] == 100 and r["suspect"] == 0
    assert r["windUnitOnPage"] == "m/s" and r["newestObservation"] > 0
    assert _rows("maitri") == 100


def test_implausible_values_are_stored_as_suspect_and_left_out_of_the_live_weather(fake_page):
    import unified_backend as ub
    from ncpor_ingestor import ingest_live_station, parse_canvasjs_series
    html = page("bharati")
    last_t, last_v = parse_canvasjs_series(html)["Wind Speed"][-1]
    html = html.replace(f"{{ x: {last_t}, y : {last_v} }}", f"{{ x: {last_t}, y : 88.0 }}", 1)
    assert "y : 88.0" in html
    fake_page["bharati"] = html
    r = ingest_live_station("bharati")
    assert r["status"] == "success" and r["suspect"] == 1
    assert r["suspectValues"][0]["parameter"] == "wind_speed" and r["suspectValues"][0]["value"] == 88.0
    assert _rows("bharati", "suspect") == 1
    assert ub.get_latest_weather_for_station("bharati")["wind"] != 88.0


def test_a_changed_page_fails_loudly_and_keeps_the_last_good_data(fake_page):
    from ncpor_ingestor import ingest_live_station
    fake_page["maitri"] = page("maitri")
    ingest_live_station("maitri")
    fake_page["maitri"] = "<html><body>New NCPOR website</body></html>"
    r = ingest_live_station("maitri")
    assert r["status"] == "failed" and "page format changed" in r["error"]
    fake_page["maitri"] = page("maitri").replace("Wind Speed (m/s)", "Wind Speed (knots)")
    r = ingest_live_station("maitri")
    assert r["status"] == "failed" and "knots" in r["error"]
    assert _rows("maitri") == 100                   # the good data is still there


def test_an_unreachable_page_is_reported_not_raised(fake_page):
    import requests

    from ncpor_ingestor import ingest_live_station
    fake_page["maitri"] = requests.ConnectionError("timed out")
    r = ingest_live_station("maitri")
    assert r["status"] == "failed" and r["error"].startswith("NCPOR page unreachable")


def test_the_schedule_backs_off_and_recovers(fake_page):
    import requests
    from ncpor_sync import NcporSync, now_ms
    sync = NcporSync(["maitri"], interval_min=30, max_backoff_min=240)
    assert [sync.delay_after(n) / 60 for n in range(5)] == [30, 60, 120, 240, 240]
    sync.start(first_delay_s=0)
    assert sync.due(now_ms() + 1) == ["maitri"]
    fake_page["maitri"] = requests.ConnectionError("down")
    sync.run("maitri")
    sync.run("maitri")
    st = sync.status()["stations"]["maitri"]
    assert st["consecutiveFailures"] == 2 and st["lastStatus"] == "failed" and st["failingSince"] is not None
    assert 115 * 60_000 < st["nextSync"] - now_ms() <= 120 * 60_000           # 30 × 2²
    fake_page["maitri"] = page("maitri")
    r = sync.run("maitri", "manual")
    assert r["status"] == "success" and r["trigger"] == "manual"
    st = sync.status()["stations"]["maitri"]
    assert st["consecutiveFailures"] == 0 and st["failingSince"] is None and st["lastReadings"] == 100
    assert 29 * 60_000 < st["nextSync"] - now_ms() <= 30 * 60_000
    assert st["storedReadings"] == 100 and st["newestObservation"] is not None


def test_a_crash_inside_one_sync_does_not_stop_the_schedule(fake_page, monkeypatch):
    import ncpor_sync
    monkeypatch.setattr(ncpor_sync, "ingest_live_station", lambda sid: 1 / 0)
    sync = ncpor_sync.NcporSync(["maitri"], interval_min=30)
    sync.start(first_delay_s=0)
    r = sync.run("maitri")
    assert r["status"] == "failed" and "internal error" in r["error"]
    assert sync.status()["stations"]["maitri"]["consecutiveFailures"] == 1


def test_off_means_no_schedule_but_manual_sync_still_works(fake_page):
    from ncpor_sync import NcporSync, now_ms
    sync = NcporSync(["maitri"], interval_min=0)
    sync.start(first_delay_s=0)
    assert sync.enabled is False and sync.due(now_ms() + 10**9) == []
    fake_page["maitri"] = page("maitri")
    assert sync.run("maitri", "manual")["status"] == "success"
    assert sync.status()["stations"]["maitri"]["nextSync"] is None


def test_status_route_is_public_and_sync_now_is_team_only(fake_page, monkeypatch):
    import asyncio

    from fastapi.testclient import TestClient

    import unified_backend as ub
    from station_store import StationStore

    async def _no_tick_loop():
        await asyncio.Event().wait()

    monkeypatch.setattr(ub, "tick_loop", _no_tick_loop)
    monkeypatch.setattr(ub, "store", StationStore(ub.STATIONS, history_max_points=50))
    monkeypatch.setattr(ub.app_config, "ADMIN_TOKEN", "t0ken")
    fake_page["maitri"] = page("maitri")
    fake_page["bharati"] = page("bharati")
    with TestClient(ub.app) as c:
        body = c.get("/api/ncpor/status").json()
        assert set(body["stations"]) == {"maitri", "bharati"} and "not independently confirmed" in body["windUnitNote"]
        assert c.post("/api/ncpor/ingest?stationId=maitri").status_code == 401
        r = c.post("/api/ncpor/ingest?stationId=maitri", headers={"X-Admin-Token": "t0ken"}).json()
        assert r["results"]["maitri"]["status"] == "success"
        assert c.get("/api/ncpor/status").json()["stations"]["maitri"]["lastReadings"] == 100
