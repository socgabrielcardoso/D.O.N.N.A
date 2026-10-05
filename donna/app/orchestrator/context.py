from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CYBER_KEYWORDS = {
    "cyber", "security", "segurança", "defender", "sentinel", "kql", "intune",
    "entra", "active directory", "ad ", "malware", "ioc", "incidente", "firewall",
    "vpn", "rede", "network", "log", "vulnerabilidade", "blue team",
}
STRATEGY_KEYWORDS = {
    "carreira", "estratégia", "estrategia", "liderança", "lideranca", "negócio",
    "negocio", "empresa", "dinheiro", "disciplina", "foco", "decisão", "decisao",
}


@dataclass(slots=True)
class ContextBuilder:
    owner_profile: dict[str, Any]

    def build(self, user_text: str, mode: str) -> str:
        owner = self.owner_profile.get("owner", {})
        low = user_text.lower()
        sections = [
            f"Owner: {owner.get('name', 'Gabriel')} ({owner.get('preferred_title', 'Chefe')}).",
            f"Primary language: {owner.get('language', 'pt-BR')}.",
            f"Profession: {owner.get('profession', 'Technology / Cybersecurity')}.",
            f"Mode: {mode}.",
        ]
        if mode.upper() == "CYBER" or any(k in low for k in CYBER_KEYWORDS):
            skills = ", ".join(owner.get("skills", []))
            sections.append(f"Relevant technical background: {skills}.")
        if mode.upper() in {"FOCUS", "WORK"} or any(k in low for k in STRATEGY_KEYWORDS):
            objectives = "; ".join(owner.get("objectives", []))
            values = ", ".join(owner.get("values", []))
            sections.append(f"Relevant objectives: {objectives}.")
            sections.append(f"Values to respect: {values}.")
        return "\n".join(sections)
