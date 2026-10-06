from __future__ import annotations

import argparse
from pathlib import Path

from donna.app.bootstrap.app import build_orchestrator


def main() -> None:
    parser = argparse.ArgumentParser(description="D.O.N.N.A. — Personal AI Operating Layer")
    parser.add_argument("--cli", action="store_true", help="Run without desktop UI")
    parser.add_argument("--diagnose", action="store_true", help="Run self-diagnosis and exit")
    parser.add_argument("--reset-first-run", action="store_true", help="Show first-run wizard again")
    parser.add_argument("--classic-ui", action="store_true", help="Use the legacy Tk desktop UI")
    args = parser.parse_args()
    root = Path.cwd()
    orchestrator = build_orchestrator(root)

    if args.diagnose:
        print(orchestrator.health_check().text)
        return

    if args.cli:
        print("D.O.N.N.A. online. Digite 'sair' para encerrar.")
        while True:
            try:
                text = input("Gabriel> ").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if text.lower() in {"sair", "exit", "quit"}:
                break
            print("D.O.N.N.A.>", orchestrator.handle(text).text)
        return

    marker = root / "data" / ".first_run_complete"
    if args.reset_first_run and marker.exists():
        marker.unlink()
    from donna.app.bootstrap.first_run import run_first_run_wizard
    run_first_run_wizard(root)
    if not args.classic_ui:
        try:
            from donna.app.ui.web_cockpit import DonnaWebCockpit

            DonnaWebCockpit(orchestrator, root).run()
            return
        except Exception:
            pass

    from donna.app.ui.desktop import DonnaDesktop
    DonnaDesktop(orchestrator).run()
