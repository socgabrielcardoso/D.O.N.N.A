$ErrorActionPreference = 'Stop'
python -m pip install -e '.[voice,vision,dev]'
pyinstaller --noconfirm --clean --windowed --name DONNA `
  --add-data "donna/app/config;donna/app/config" `
  --collect-all pyttsx3 `
  main.py
Write-Host 'Build em dist/DONNA/'
