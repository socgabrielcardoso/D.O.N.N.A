from donna.app.memory.store import MemoryItem, MemoryStore


def test_memory_roundtrip(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    assert store.remember(MemoryItem("pref", "gosta de respostas diretas"))
    assert store.get("pref") == "gosta de respostas diretas"
    assert store.forget("pref")


def test_memory_blocks_secrets_and_private_mode(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    assert not store.remember(MemoryItem("api key", "example-secret-value"))
    store.private_mode = True
    assert not store.remember(MemoryItem("pref", "x"))


def test_stable_key_survives_process_semantics(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    assert store.stable_key("abc") == store.stable_key("abc")
    assert store.stable_key("abc") != store.stable_key("def")


def test_forget_matching_value(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    store.remember(MemoryItem(store.stable_key("prefere café"), "prefere café"))
    assert store.forget_matching("café") == 1
    assert store.all() == []
