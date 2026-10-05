$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
Set-Location $Root

$Python = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    try {
        py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)"
        $Python = @('py', '-3')
    } catch { }
}
if (-not $Python -and (Get-Command python -ErrorAction SilentlyContinue)) {
    python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)"
    $Python = @('python')
}
if (-not $Python) { throw 'Python 3.11+ não encontrado.' }

if ($Python.Count -eq 2) { & $Python[0] $Python[1] -m venv .venv } else { & $Python[0] -m venv .venv }
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -e ".[voice,vision]"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut("$env:USERPROFILE\Desktop\D.O.N.N.A..lnk")
$Shortcut.TargetPath = "$Root\.venv\Scripts\pythonw.exe"
$Shortcut.Arguments = "`"$Root\main.py`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Save()
Write-Host 'D.O.N.N.A. instalada. Abra pelo atalho da Área de Trabalho.'
