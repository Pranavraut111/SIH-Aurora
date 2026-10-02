"""Data layer (D): one SQLite helper (WAL, busy timeout, parameterised SQL),
logistics audit log + history, simulated remote-command lifecycle."""

import importlib
import re
import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SIM_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def client(temp_db):
    import unified_backend as ub
    with TestClient(ub.app) as c:
        yield c, ub


# ── the helper ────────────────────────────────────────────────

def test_helper_uses_wal_and_busy_timeout(temp_db):
    import db
    with db.connect() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] >= 5000
        assert isinstance(conn.execute("SELECT 1 AS x").fetchone(), sqlite3.Row)


def test_helper_rolls_back_on_error(temp_db):
    import db
    with pytest.raises(RuntimeError):
        with db.connect() as conn:
            conn.execute("UPDATE logistics_inventory SET current = 1 WHERE id = 'maitri-fuel'")
            raise RuntimeError("boom")
    with db.connect() as conn:
        assert conn.execute("SELECT current FROM logistics_inventory WHERE id = 'maitri-fuel'").fetchone()[0] != 1


def test_concurrent_writers_do_not_fail(temp_db):
    import db
    errors = []

    def writer(n):
        try:
            for i in range(20):
                with db.connect() as conn:
                    conn.execute("INSERT INTO logistics_audit (station_id, item_id, field, old_value, new_value, "
                                 "updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                 ("maitri", "maitri-fuel", "current", str(i), str(i + 1), f"w{n}", i))
        except Exception as exc:          # collected and asserted below
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    with db.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM logistics_audit").fetchone()[0] == 80


def test_no_raw_sqlite_connect_or_fstring_sql_in_services():
    """Static proof: services only open the DB through db.connect(), and no SQL is built with f-strings."""
    service_files = [p for p in SIM_DIR.glob("*.py") if p.name not in ("db.py",) and not p.name.startswith("test_")]
    service_files += list((SIM_DIR / "migrations").glob("*.py"))
    fstring_sql = re.compile(r"""f["'][^"'\n]*\b(SELECT|INSERT|UPDATE|DELETE|WHERE|LIMIT|FROM)\b""")
    for path in service_files:
        text = path.read_text()
        assert "sqlite3.connect(" not in text, path.name
        assert not fstring_sql.search(text), path.name


# ── logistics ─────────────────────────────────────────────────

def test_logistics_update_is_validated_and_audited(client):
    c, _ = client
    ok = c.post("/api/logistics/update", json={"stationId": "maitri", "itemId": "maitri-fuel", "current": 60000,
                                               "dailyConsumption": 300, "updatedBy": "Logistics Officer"})
    assert ok.status_code == 200 and ok.json()["changes"] == 2
    hist = c.get("/api/logistics/history?stationId=maitri&itemId=maitri-fuel").json()["history"]
    fields = {h["field"]: h for h in hist}
    assert fields["current"]["oldValue"] == "68400.0" and fields["current"]["newValue"] == "60000.0"
    assert fields["daily_consumption"]["updatedBy"] == "Logistics Officer" and fields["current"]["updatedAt"] > 0

    bad = [
        ({"current": -1}, 422),                         # negative inventory
        ({"current": 10**6}, 422),                      # above max capacity (100 000 L)
        ({"itemId": "maitri-unicorns"}, 404),           # unknown item
        ({"itemId": "bharati-fuel"}, 404),              # item of another station
        ({"updatedBy": ""}, 422),                       # empty name
        ({"updatedBy": "x" * 61}, 422),                 # too long
        ({"updatedBy": "<script>"}, 422),               # invalid characters
        ({"stationId": "xyz"}, 404),
        ({"extra": 1}, 422),                            # unknown field
    ]
    base = {"stationId": "maitri", "itemId": "maitri-fuel", "current": 50000, "updatedBy": "Logistics Officer"}
    for patch, code in bad:
        r = c.post("/api/logistics/update", json={**base, **patch})
        assert r.status_code == code, (patch, r.status_code, r.text)
    assert c.get("/api/logistics/history?stationId=maitri&limit=0").status_code == 422


# ── remote commands ───────────────────────────────────────────

def test_remote_command_lifecycle_and_validation(client):
    c, ub = client
    r = c.post("/api/remote/dispatch", json={"stationId": "bharati", "subsystem": "Comms Tower",
                                             "command": "STOW_DISH_BLIZZARD_MODE", "issuedBy": "test operator"})
    assert r.status_code == 200 and r.json()["status"] == ub.CMD_QUEUED
    cmd = c.get("/api/remote/commands?stationId=bharati").json()["commands"][0]
    assert [s["state"] for s in cmd["lifecycle"]] == [ub.CMD_QUEUED]

    assert ub.promote_remote_commands(now_ms=cmd["created_at"] + 10**6) >= 1
    cmd = c.get("/api/remote/commands?stationId=bharati").json()["commands"][0]
    assert cmd["status"] == ub.CMD_ACKNOWLEDGED
    assert [s["state"] for s in cmd["lifecycle"]] == [ub.CMD_QUEUED, ub.CMD_ACKNOWLEDGED]
    assert "executed" not in cmd["status"] and cmd["executed_at"] is None

    base = {"stationId": "bharati", "subsystem": "Comms Tower", "command": "STOW_DISH_BLIZZARD_MODE",
            "issuedBy": "test operator"}
    for patch in ({"subsystem": "Death Ray"}, {"command": "SELF_DESTRUCT"}, {"command": "DROP TABLE"},
                  {"issuedBy": "a"}, {"parameters": {str(i): i for i in range(11)}}):
        assert c.post("/api/remote/dispatch", json={**base, **patch}).status_code == 422, patch
    assert c.post("/api/remote/dispatch", json={**base, "stationId": "nowhere"}).status_code == 404


def test_migration_004_relabels_legacy_executed_rows(tmp_path):
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(db_path))   # build a pre-migration DB by hand
    conn.execute("""CREATE TABLE remote_commands (id TEXT PRIMARY KEY, station_id TEXT, subsystem TEXT, command TEXT,
                    parameters TEXT, status TEXT, created_at INTEGER, dispatched_at INTEGER, executed_at INTEGER,
                    issued_by TEXT, response_log TEXT)""")
    conn.execute("INSERT INTO remote_commands VALUES ('C1','maitri','Power Grid','X','{}','executed',1,2,NULL,'op',"
                 "'Command acknowledged and applied to station')")
    conn.commit()
    mig = importlib.import_module("migrations")
    results = dict((i, d) for i, _, d in mig.run_migrations(conn, only={"004_remote_command_lifecycle"}))
    assert results["004_remote_command_lifecycle"]["relabelled_legacy_rows"] == 1
    row = conn.execute("SELECT status, acknowledged_at, response_log FROM remote_commands").fetchone()
    conn.close()
    assert row[0] == "acknowledged (simulated)" and row[1] == 2
    assert "nothing was executed" in row[2] and "applied to station" in row[2]   # original text kept


def test_remote_page_labels_match_the_catalogue():
    """The Remote commands page renders its buttons from the backend catalogue, so it can only
    send catalogue commands. Its plain-language label table must cover exactly that catalogue:
    every command has a label, and no label names a command the backend would reject."""
    import station_config as sc
    src = (SIM_DIR.parent / "src" / "modules" / "remote" / "RemoteModule.jsx").read_text()
    table = re.search(r"const COMMAND_LABEL = \{(.*?)\};", src, re.S)
    assert table
    labelled = set(re.findall(r"^\s*([A-Z_]+):", table.group(1), re.M))
    catalog = {c for k, cmds in sc.remote_command_catalog().items() if not k.startswith("_") for c in cmds}
    assert labelled == catalog, (labelled ^ catalog)
