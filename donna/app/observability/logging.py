from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

from donna.app.security.redaction import redact

SECURITY = 35
AUDIT = 25
logging.addLevelName(SECURITY, "SECURITY")
logging.addLevelName(AUDIT, "AUDIT")


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def configure_logging(log_dir: Path, private_mode: bool = False) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("donna")
    logger.setLevel(logging.WARNING if private_mode else logging.INFO)
    logger.propagate = False
    if logger.handlers:
        return logger
    handler = RotatingFileHandler(log_dir / "donna.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    return logger
