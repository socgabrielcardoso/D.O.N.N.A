$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
Set-Location $Root

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

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

function Resolve-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $Candidate = @('py', '-3')
        if (Test-PythonCandidate $Candidate) { return ,$Candidate }
    }

    if (Get-Command python -ErrorAction SilentlyContinue) {
        $Candidate = @('python')
        if (Test-PythonCandidate $Candidate) { return ,$Candidate }
    }

    $KnownPythonPaths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'),
        (Join-Path $env:ProgramFiles 'Python312\python.exe'),
        (Join-Path $env:ProgramFiles 'Python311\python.exe')
    )
    foreach ($KnownPython in $KnownPythonPaths) {
        if (Test-Path $KnownPython) {
            $Candidate = @($KnownPython)
            if (Test-PythonCandidate $Candidate) { return ,$Candidate }
        }
    }
    return $null
}

function Resolve-Ollama {
    $Cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($Cmd) { return $Cmd.Source }

    $Candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe')
    )
    foreach ($Candidate in $Candidates) {
        if (Test-Path $Candidate) { return $Candidate }
    }
    return $null
}

Write-Step "VALIDANDO PYTHON"
$Python = Resolve-Python
if (-not $Python) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Python 3.11+ não encontrado e winget indisponível.'
    }
    Write-Host "Python 3.12 não encontrado. Instalando pelo winget..." -ForegroundColor Yellow
    winget install --id Python.Python.3.12 -e --source winget --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    $Python = Resolve-Python
}
if (-not $Python) { throw 'Python 3.11+ não pôde ser instalado/localizado.' }

Write-Step "CRIANDO AMBIENTE D.O.N.N.A."
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

.\.venv\Scripts\python.exe -m pip install -e ".[voice,vision,webui]"
if ($LASTEXITCODE -ne 0) { throw 'Falha ao instalar dependências da D.O.N.N.A.' }

Write-Step "VALIDANDO OLLAMA"
$Ollama = Resolve-Ollama
if (-not $Ollama) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw 'Ollama não encontrado e winget indisponível.'
    }
    Write-Host "Ollama não encontrado. Instalando..." -ForegroundColor Yellow
    winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
    $Ollama = Resolve-Ollama
}
if (-not $Ollama) { throw 'Ollama não pôde ser instalado/localizado.' }

try {
    Invoke-RestMethod "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
} catch {
    Start-Process $Ollama -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
}

Write-Step "VALIDANDO MODELO LOCAL"
$ModelName = 'qwen3:4b'
$InstalledModels = (& $Ollama list 2>$null | Out-String)
if ($InstalledModels -notmatch [regex]::Escape($ModelName)) {
    Write-Host "Baixando $ModelName. Isso acontece só na primeira instalação..." -ForegroundColor Yellow
    & $Ollama pull $ModelName
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $ModelName." }
}
[Environment]::SetEnvironmentVariable("OLLAMA_MODEL", $ModelName, "User")
$env:OLLAMA_MODEL = $ModelName

Write-Step "INSTALANDO MODELO DE VOZ PT-BR"
$Models = Join-Path $Root "models"
$VoskModel = Join-Path $Models "vosk-model-small-pt-0.3"
if (-not (Test-Path $VoskModel)) {
    New-Item -ItemType Directory -Force -Path $Models | Out-Null
    $Zip = Join-Path $env:TEMP "vosk-model-small-pt-0.3.zip"
    Invoke-WebRequest -Uri "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip" -OutFile $Zip
    Expand-Archive -Path $Zip -DestinationPath $Models -Force
    Remove-Item $Zip -Force -ErrorAction SilentlyContinue
}
[Environment]::SetEnvironmentVariable("DONNA_VOSK_MODEL_PATH", $VoskModel, "User")
$env:DONNA_VOSK_MODEL_PATH = $VoskModel

Write-Step "CONFIGURANDO COCKPIT VERCEL"
[Environment]::SetEnvironmentVariable(
    "DONNA_WEB_URL",
    "https://donna-ai-nine.vercel.app",
    "User"
)
$env:DONNA_WEB_URL = "https://donna-ai-nine.vercel.app"

Write-Step "CRIANDO ATALHO"
$Desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
if (-not $Desktop) { $Desktop = $env:USERPROFILE }

$Shell = New-Object -ComObject WScript.Shell
$ShortcutPath = Join-Path $Desktop 'D.O.N.N.A.lnk'
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "$Root\.venv\Scripts\pythonw.exe"
$Shortcut.Arguments = "`"$Root\main.py`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Save()

Write-Step "AUTOTESTE"
$Diagnosis = & .\.venv\Scripts\python.exe main.py --diagnose 2>&1 | Out-String
Write-Host $Diagnosis

Write-Host ""
Write-Host "D.O.N.N.A. Windows pronta." -ForegroundColor Green
Write-Host "Atalho: $ShortcutPath"
Write-Host "Modelo local: $ModelName"
Write-Host "STT offline: $VoskModel"
Write-Host "Abra normalmente pelo atalho; não use Executar como administrador."
