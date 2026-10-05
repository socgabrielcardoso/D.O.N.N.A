from donna.app.orchestrator.context import ContextBuilder


PROFILE = {
    "owner": {
        "name": "Gabriel",
        "preferred_title": "Chefe",
        "language": "pt-BR",
        "profession": "Cybersecurity",
        "skills": ["Sentinel", "KQL"],
        "objectives": ["liderança"],
        "values": ["disciplina"],
    }
}


def test_context_builder_selects_cyber_context():
    text = ContextBuilder(PROFILE).build("crie um KQL para o Sentinel", "NORMAL")
    assert "Sentinel" in text and "KQL" in text


def test_context_builder_avoids_irrelevant_strategy_context():
    text = ContextBuilder(PROFILE).build("que horas são", "NORMAL")
    assert "liderança" not in text
