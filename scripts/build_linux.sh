#!/usr/bin/env bash
set -euo pipefail
python -m pip install -e '.[voice,vision,dev]'
pyinstaller --noconfirm --clean --windowed --name DONNA \
  --add-data 'donna/app/config:donna/app/config' \
  main.py
echo 'Build em dist/DONNA/'
