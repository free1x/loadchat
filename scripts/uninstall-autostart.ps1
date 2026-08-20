$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'LoadChat' -ErrorAction SilentlyContinue
if ($task) {
  Unregister-ScheduledTask -TaskName 'LoadChat' -Confirm:$false
  Write-Host 'The LoadChat startup task was removed. Program files and local data were kept.' -ForegroundColor Green
} else {
  Write-Host 'The LoadChat startup task was not found.' -ForegroundColor Yellow
}
