# Instalador de Lexema CLI para Windows.
# Uso (PowerShell):
#   irm https://lexemalabs.shop/install.ps1 | iex
#
# Sube este archivo a la raiz del sitio de lexemalabs.shop (el mismo proyecto
# de Cloudflare Pages) para que quede disponible en https://lexemalabs.shop/install.ps1

$ErrorActionPreference = "Stop"

# --- Configura esto con tu repositorio real ---
$Repo = "diegoabdo/lexema-cli"
$BinName = "lexema"
$InstallDir = "$env:LOCALAPPDATA\Lexema"
# -----------------------------------------------

$asset = "$BinName-win-x64.exe"
$apiUrl = "https://api.github.com/repos/$Repo/releases/latest"

Write-Host "Buscando la ultima version en $apiUrl..."
$release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "lexema-installer" }

$asset_info = $release.assets | Where-Object { $_.name -eq $asset }
if (-not $asset_info) {
  Write-Error "No se encontro un binario llamado '$asset' en el ultimo Release de $Repo."
  exit 1
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$destination = Join-Path $InstallDir "$BinName.exe"

Write-Host "Descargando $($asset_info.browser_download_url)..."
Invoke-WebRequest -Uri $asset_info.browser_download_url -OutFile $destination

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$InstallDir", "User")
  Write-Host "Se agrego $InstallDir al PATH del usuario. Abre una nueva terminal para usarlo."
}

Write-Host "Lexema CLI instalado en $destination"
Write-Host "Prueba con: $BinName ask `"Hola`""
