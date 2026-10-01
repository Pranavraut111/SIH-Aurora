"""APP_ENV=production must refuse a development-grade configuration, and say which
variable is wrong. Outside production the same problems are warnings only, so local
development is untouched.
"""

import pytest

import config as app_config


@pytest.fixture
def cfg(monkeypatch):
    """A clean production-ready config the tests then break one field at a time."""
    monkeypatch.setattr(app_config, "APP_ENV", "production")
    monkeypatch.setattr(app_config, "ADMIN_TOKEN", "a-real-token")
    monkeypatch.setattr(app_config, "ALLOWED_ORIGINS", ["https://aurora.example.org"])
    return app_config


def test_a_complete_production_config_passes(cfg):
    assert cfg.production_config_errors() == []
    cfg.check_production_config()      # must not raise


def test_an_empty_admin_token_is_refused(cfg, monkeypatch):
    monkeypatch.setattr(cfg, "ADMIN_TOKEN", "")
    errors = cfg.production_config_errors()
    assert len(errors) == 1
    assert "ADMIN_TOKEN" in errors[0]
    assert "openssl rand -hex 32" in errors[0]      # tells the operator how to fix it
    with pytest.raises(SystemExit) as exc:
        cfg.check_production_config()
    assert "Refusing to start" in str(exc.value)
    assert "ADMIN_TOKEN" in str(exc.value)


@pytest.mark.parametrize("origin", [
    "http://localhost",
    "http://localhost:5173",
    "http://127.0.0.1",
    "https://127.0.0.1:8443",
])
def test_development_origins_are_refused(cfg, monkeypatch, origin):
    monkeypatch.setattr(cfg, "ALLOWED_ORIGINS", [origin])
    errors = cfg.production_config_errors()
    assert len(errors) == 1
    assert "ALLOWED_ORIGINS" in errors[0]
    assert origin in errors[0]
    with pytest.raises(SystemExit):
        cfg.check_production_config()


def test_a_development_origin_alongside_a_real_one_is_still_refused(cfg, monkeypatch):
    """A leftover localhost entry is exactly the mistake this check exists to catch."""
    monkeypatch.setattr(cfg, "ALLOWED_ORIGINS",
                        ["https://aurora.example.org", "http://localhost:5173"])
    errors = cfg.production_config_errors()
    assert len(errors) == 1 and "localhost" in errors[0]


def test_both_problems_are_reported_together(cfg, monkeypatch):
    monkeypatch.setattr(cfg, "ADMIN_TOKEN", "")
    monkeypatch.setattr(cfg, "ALLOWED_ORIGINS", ["http://localhost:5173"])
    assert len(cfg.production_config_errors()) == 2
    with pytest.raises(SystemExit) as exc:
        cfg.check_production_config()
    message = str(exc.value)
    assert "ADMIN_TOKEN" in message and "ALLOWED_ORIGINS" in message
    assert "docs/DEPLOYMENT.md" in message


def test_development_only_warns(cfg, monkeypatch, caplog):
    """The same broken config must not stop a local run."""
    monkeypatch.setattr(cfg, "APP_ENV", "development")
    monkeypatch.setattr(cfg, "ADMIN_TOKEN", "")
    monkeypatch.setattr(cfg, "ALLOWED_ORIGINS", ["http://localhost:5173"])
    with caplog.at_level("WARNING"):
        cfg.check_production_config()       # must not raise
    assert any("Insecure for a public deployment" in r.message for r in caplog.records)


def test_the_token_is_never_logged(cfg, monkeypatch, caplog):
    monkeypatch.setattr(cfg, "APP_ENV", "development")
    monkeypatch.setattr(cfg, "ADMIN_TOKEN", "super-secret-token")
    monkeypatch.setattr(cfg, "ALLOWED_ORIGINS", ["http://localhost:5173"])
    with caplog.at_level("WARNING"):
        cfg.check_production_config()
    assert "super-secret-token" not in caplog.text
    assert cfg.summary()["ADMIN_TOKEN"] == "set"
