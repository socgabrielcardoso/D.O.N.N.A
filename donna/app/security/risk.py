from __future__ import annotations

from dataclasses import dataclass

from donna.app.core.models import RiskLevel, ToolSpec


@dataclass(slots=True)
class RiskDecision:
    allowed: bool
    confirmation_required: bool
    reason: str


class RiskEngine:
    ORDER = {r: i for i, r in enumerate(RiskLevel)}

    def evaluate(self, spec: ToolSpec, explicit_confirmation: bool = False) -> RiskDecision:
        mandatory = spec.requires_confirmation or self.ORDER[spec.risk] >= self.ORDER[RiskLevel.R3]
        if mandatory and not explicit_confirmation:
            return RiskDecision(False, True, f"{spec.name} is {spec.risk.value} and requires confirmation")
        return RiskDecision(True, False, "allowed")
