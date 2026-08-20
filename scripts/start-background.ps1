$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
$LogDir = Join-Path $ProjectRoot "data\logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

if (-not (Test-Path -LiteralPath "node_modules")) { npm install }
$PackageVersion = node -p "require('./package.json').version"
$BuildVersion = if (Test-Path -LiteralPath "dist\.loadchat-version") { (Get-Content -LiteralPath "dist\.loadchat-version" -Raw).Trim() } else { '' }
if (-not (Test-Path -LiteralPath "dist-server\index.js") -or -not (Test-Path -LiteralPath "dist\index.html") -or $BuildVersion -ne $PackageVersion) {
  npm run build
}

$NodePath = (Get-Command node).Source
Start-Process -FilePath $NodePath -ArgumentList "dist-server/index.js" -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir "loadchat.out.log") -RedirectStandardError (Join-Path $LogDir "loadchat.error.log")
