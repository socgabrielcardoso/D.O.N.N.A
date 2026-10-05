from donna.app.core.models import RiskLevel, ToolSpec
from donna.app.security.risk import RiskEngine


def test_r0_allowed_without_confirmation():
    decision = RiskEngine().evaluate(ToolSpec("read", "read", RiskLevel.R0))
    assert decision.allowed and not decision.confirmation_required


def test_r3_requires_confirmation():
    spec = ToolSpec("delete", "delete", RiskLevel.R3)
    decision = RiskEngine().evaluate(spec)
    assert not decision.allowed and decision.confirmation_required
    assert RiskEngine().evaluate(spec, explicit_confirmation=True).allowed
