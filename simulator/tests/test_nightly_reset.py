"""The nightly reset puts the shared demo back to the recorded baseline (judge mode)."""

import json

import pytest


@pytest.fixture
def nightly(temp_db, monkeypatch):
    import judge_mode
    import nightly_reset
    monkeypatch.setattr(judge_mode, "SANDBOX", judge_mode.SandboxStore())
    monkeypatch.setattr(nightly_reset, "SANDBOX", judge_mode.SANDBOX)
    resets = []

    class _Ok:
        def raise_for_status(self):
            return None

    monkeypatch.setattr(nightly_reset.requests, "post",
                        lambda url, params=None, timeout=None: resets.append(params) or _Ok())
    return nightly_reset, resets


def test_the_committed_baseline_is_valid_and_matches_the_seeded_ledger(nightly):
    nr, _ = nightly
    import db
    base = nr.load_baseline()
    with db.connect() as conn:
        ids = {r["id"] for r in conn.execute("SELECT id FROM logistics_inventory")}
    assert set(base["ledger"]) == ids


def test_it_restores_thresholds_ledger_ends_scenarios_and_drops_expired_sandboxes(nightly):
    nr, resets = nightly
    import judge_mode

    import alert_engine
    import db
    base = nr.load_baseline()
    # A day of use: a team threshold change, a ledger edit, an expired and a live sandbox.
    alert_engine.save_overrides("maitri", {"gen_temp": {"high": {"critical": 97.0}}}, "team")
    with db.connect() as conn:
        conn.execute("UPDATE logistics_inventory SET current = 1 WHERE id = 'maitri-fuel'")
    old, _ = judge_mode.SANDBOX.create()
    live, _ = judge_mode.SANDBOX.create()
    with db.connect() as conn:
        conn.execute("UPDATE sandbox_sessions SET expires_at = 0 WHERE id = ?", (old,))

    summary = nr.run()

    assert summary["ok"] is True
    assert [r["station"] for r in resets] == ["maitri", "bharati"]
    assert all(r["source"] == "nightly" for r in resets)
    assert len(alert_engine.load_overrides()) == len(base["thresholdOverrides"])
    with db.connect() as conn:
        fuel = conn.execute("SELECT current, updated_by FROM logistics_inventory WHERE id = 'maitri-fuel'").fetchone()
        audit = conn.execute("SELECT * FROM logistics_audit WHERE item_id = 'maitri-fuel' ORDER BY id DESC").fetchone()
        sessions = {r["id"] for r in conn.execute("SELECT id FROM sandbox_sessions")}
    assert fuel["current"] == base["ledger"]["maitri-fuel"]["current"] and fuel["updated_by"] == "nightly reset"
    assert audit["updated_by"] == "nightly reset"
    assert audit["new_value"] == str(base["ledger"]["maitri-fuel"]["current"])
    assert sessions == {live}
    assert summary["ledgerItemsRestored"] == 1 and summary["sandboxSessionsRemoved"] == 1


def test_a_failed_simulator_reset_is_reported(nightly, monkeypatch):
    nr, _ = nightly

    def down(*a, **k):
        raise nr.requests.ConnectionError("simulator down")

    monkeypatch.setattr(nr.requests, "post", down)
    summary = nr.run()
    assert summary["ok"] is False and summary["simulatorResetFailed"] == ["maitri", "bharati"]


def test_a_bad_baseline_is_refused(tmp_path):
    import nightly_reset
    bad = tmp_path / "b.json"
    bad.write_text(json.dumps({"ledger": []}))
    with pytest.raises(ValueError):
        nightly_reset.load_baseline(bad)
