$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
Set-Location $Root

function Test-PythonCandidate {
    param([string[]]$Command)

    try {
        if ($Command.Count -eq 2) {
            & $Command[0] $Command[1] -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" *> $null
        } else {
            & $Command[0] -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)" *> $null
        }
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

$Python = $null

if (Get-Command py -ErrorAction SilentlyContinue) {
    $Candidate = @('py', '-3')
    if (Test-PythonCandidate $Candidate) {
        $Python = $Candidate
    }
}

if (-not $Python -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $Candidate = @('python')
    if (Test-PythonCandidate $Candidate) {
        $Python = $Candidate
    }
}

if (-not $Python) {
    $KnownPythonPaths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'),
        (Join-Path $env:ProgramFiles 'Python312\python.exe'),
        (Join-Path $env:ProgramFiles 'Python311\python.exe')
    )

    foreach ($KnownPython in $KnownPythonPaths) {
        if (Test-Path $KnownPython) {
            $Candidate = @($KnownPython)
            if (Test-PythonCandidate $Candidate) {
                $Python = $Candidate
                break
            }
        }
    }
}

if (-not $Python) {
    throw 'Python 3.11+ real não encontrado. Instale Python 3.12 pelo winget e execute este instalador novamente.'
}

if ($Python.Count -eq 2) {
    & $Python[0] $Python[1] -m venv .venv
} else {
    & $Python[0] -m venv .venv
}

if ($LASTEXITCODE -ne 0 -or -not (Test-Path '.\.venv\Scripts\python.exe')) {
    throw 'Falha ao criar o ambiente virtual .venv.'
}

.\.venv\Scripts\python.exe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar o pip.' }

.\.venv\Scripts\python.exe -m pip install -e ".[voice,vision]"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar as dependências da D.O.N.N.A.' }

$Desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not $Desktop) {
    $Desktop = $env:USERPROFILE
}

$Shell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $Desktop 'D.O.N.N.A..lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$Root\.venv\Scripts\pythonw.exe"
$Shortcut.Arguments = "`"$Root\main.py`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Save()

Write-Host ''
Write-Host 'D.O.N.N.A. instalada com sucesso.'
Write-Host "Atalho criado em: $ShortcutPath"
Write-Host 'Abra pelo atalho D.O.N.N.A. na sua Área de Trabalho.'
