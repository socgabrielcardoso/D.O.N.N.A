from donna.app.config.loader import Config


def test_config_persists_user_settings(tmp_path):
    cfg = Config({"assistant": {"mode": "NORMAL"}}, tmp_path)
    cfg.set("assistant.mode", "CYBER", persist=True)
    text = (tmp_path / "user.yaml").read_text(encoding="utf-8")
    assert "CYBER" in text
