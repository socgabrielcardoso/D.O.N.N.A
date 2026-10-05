from donna.app.memory.store import ConversationTurn, MemoryItem, MemoryStore


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


def test_conversation_memory_and_relevant_context(tmp_path):
    store = MemoryStore(tmp_path / "memory.db")
    assert store.remember_turn(
        ConversationTurn(
            "Estou estudando KQL no Sentinel",
            "Ótimo, vamos praticar consultas.",
            "fake",
        )
    )
    assert store.remember(MemoryItem("goal:cyber", "Quero evoluir em cybersecurity", "goal"))

    context = store.relevant_context("quero estudar Sentinel e cybersecurity")
    assert "Sentinel" in context
    assert "cybersecurity" in context
    stats = store.stats()
    assert stats["conversation_turns"] == 1
    assert stats["memories"] == 1


def test_private_mode_blocks_conversation_persistence(tmp_path):
    store = MemoryStore(tmp_path / "memory.db", private_mode=True)
    assert not store.remember_turn(ConversationTurn("teste", "resposta", "fake"))
    assert store.stats()["conversation_turns"] == 0
