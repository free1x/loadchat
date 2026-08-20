$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot
if (-not (Test-Path -LiteralPath "node_modules")) { npm install }
$PackageVersion = node -p "require('./package.json').version"
$BuildVersion = if (Test-Path -LiteralPath "dist\.loadchat-version") { (Get-Content -LiteralPath "dist\.loadchat-version" -Raw).Trim() } else { '' }
if (-not (Test-Path -LiteralPath "dist-server\index.js") -or -not (Test-Path -LiteralPath "dist\index.html") -or $BuildVersion -ne $PackageVersion) { npm run build }
$NodePath = (Get-Command node).Source
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "dist-server/index.js" -WorkingDirectory $ProjectRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "LoadChat" -Action $Action -Trigger $Trigger -Settings $Settings -Description "LoadChat LAN chat and file transfer" -Force | Out-Null
Write-Host "Created the LoadChat logon task." -ForegroundColor Green
