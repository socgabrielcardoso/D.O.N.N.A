import json

from donna.app.memory.seed import import_private_memory_seed
from donna.app.memory.store import MemoryStore


def test_private_memory_seed_imports_and_updates_idempotently(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    seed = tmp_path / "owner_memory.private.json"
    seed.write_text(
        json.dumps(
            {
                "memories": [
                    {"key": "profile:name", "category": "profile", "value": "Nome: Gabriel"},
                    {
                        "category": "preference",
                        "value": "Prefere respostas técnicas diretas e copiáveis.",
                    },
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    first = import_private_memory_seed(store, seed)
    second = import_private_memory_seed(store, seed)

    assert first.imported == 2
    assert second.imported == 2
    assert store.get("profile:name") == "Nome: Gabriel"
    assert store.stats()["memories"] == 2


def test_private_memory_seed_filters_sensitive_content(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    seed = tmp_path / "owner_memory.private.json"
    seed.write_text(
        json.dumps(
            {
                "memories": [
                    {
                        "category": "unsafe",
                        "value": "Minha senha é example-password-value",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    report = import_private_memory_seed(store, seed)
    assert report.imported == 0
    assert report.skipped == 1


def test_private_memory_seed_missing_file_is_noop(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    report = import_private_memory_seed(store, tmp_path / "missing.json")

    assert report.imported == 0
    assert report.skipped == 0
    assert report.invalid == 0
