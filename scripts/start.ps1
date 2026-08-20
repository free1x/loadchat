$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js was not found. Install Node.js 22 or newer first." -ForegroundColor Red
  Write-Host "https://nodejs.org/"
  exit 1
}

$NodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -lt 22) {
  Write-Host "LoadChat requires Node.js 22+. Current version: $(node --version)" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  Write-Host "First run: installing dependencies..." -ForegroundColor Cyan
  npm install
}
$PackageVersion = node -p "require('./package.json').version"
$BuildVersion = if (Test-Path -LiteralPath "dist\.loadchat-version") { (Get-Content -LiteralPath "dist\.loadchat-version" -Raw).Trim() } else { '' }
if (-not (Test-Path -LiteralPath "dist-server\index.js") -or -not (Test-Path -LiteralPath "dist\index.html") -or $BuildVersion -ne $PackageVersion) {
  Write-Host "Building LoadChat..." -ForegroundColor Cyan
  npm run build
}

$env:NODE_ENV = "production"
Write-Host "Starting LoadChat. Press Ctrl+C to stop." -ForegroundColor Green
node dist-server/index.js
