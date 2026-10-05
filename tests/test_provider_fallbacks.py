from donna.app.providers.http import LocalFallbackProvider, VercelProvider


def test_local_fallback_extracts_researched_context():
    provider = LocalFallbackProvider()
    system = """
WEB RESEARCH:
[Fonte 1]
Título: Céu
URL: https://example.com/ceu
Conteúdo: O céu é a aparência da atmosfera terrestre vista da superfície. A luz solar é espalhada pelos gases da atmosfera.
END WEB RESEARCH
"""
    answer = provider.complete(system, "o que é céu?")
    assert "atmosfera" in answer.lower()
    assert "pesquisei" in answer.lower()


def test_vercel_provider_is_opt_in(monkeypatch):
    monkeypatch.delenv("DONNA_VERCEL_URL", raising=False)
    provider = VercelProvider()
    assert not provider.available()

    monkeypatch.setenv("DONNA_VERCEL_URL", "https://example.vercel.app")
    assert provider.available()
