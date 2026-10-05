#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)' || { echo 'Python 3.11+ é obrigatório.'; exit 1; }
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e '.[voice,vision]'
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/donna.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=D.O.N.N.A.
Exec=$ROOT/.venv/bin/python $ROOT/main.py
Path=$ROOT
Terminal=false
Categories=Utility;
DESKTOP
chmod +x "$HOME/.local/share/applications/donna.desktop"
echo 'D.O.N.N.A. instalada no menu de aplicativos.'
