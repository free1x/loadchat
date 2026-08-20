$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tlsDirectory = Join-Path $projectRoot 'data\tls'
$certFile = Join-Path $tlsDirectory 'cert.pem'
$keyFile = Join-Path $tlsDirectory 'key.pem'

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  Write-Host 'mkcert was not found. Install it from https://github.com/FiloSottile/mkcert and run this script again.' -ForegroundColor Yellow
  exit 1
}

New-Item -ItemType Directory -Path $tlsDirectory -Force | Out-Null
$addresses = @('localhost', '127.0.0.1', '::1', 'loadchat.local')
$addresses += Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
  Select-Object -ExpandProperty IPAddress
$addresses = $addresses | Select-Object -Unique

& mkcert -install
if ($LASTEXITCODE -ne 0) { throw 'Unable to install the mkcert root certificate.' }
& mkcert -cert-file $certFile -key-file $keyFile @addresses
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the LAN certificate.' }

Write-Host "HTTPS certificate created: $certFile" -ForegroundColor Green
Write-Host 'Restart LoadChat to enable HTTPS/WSS. Client devices must trust the mkcert root CA.'
