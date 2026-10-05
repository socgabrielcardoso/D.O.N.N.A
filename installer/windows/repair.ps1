$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot | Split-Path -Parent
Set-Location $Root

Write-Host "Atualizando D.O.N.N.A..." -ForegroundColor Cyan
git pull
if ($LASTEXITCODE -ne 0) { throw "Falha no git pull." }

Write-Host "Reparando dependências e modelos..." -ForegroundColor Cyan
powershell -NoProfile -ExecutionPolicy Bypass -File ".\installer\windows\install.ps1"
