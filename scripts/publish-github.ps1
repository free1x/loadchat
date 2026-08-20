param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')]
  [string]$Repository,
  [string]$Description = 'Private LAN chat and resumable file sharing in the browser.',
  [switch]$PublishRelease,
  [switch]$SkipScreenshotCheck
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw 'GitHub CLI is required. Install it, then run: gh auth login'
}
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'GitHub CLI is not authenticated. Run: gh auth login' }

if (-not $SkipScreenshotCheck) {
  $RequiredScreenshots = @('docs/images/home.webp', 'docs/images/chat.webp', 'docs/images/files.webp', 'docs/images/preview.webp', 'docs/images/mobile.webp')
  $MissingScreenshots = $RequiredScreenshots | Where-Object { -not (Test-Path -LiteralPath $_) }
  if ($MissingScreenshots) { throw "Missing sanitized release screenshots: $($MissingScreenshots -join ', ')" }
}

& npm run check:publication
if ($LASTEXITCODE -ne 0) { throw 'Publication safety check failed.' }
& npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
& npm run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }

& git add .
if ($LASTEXITCODE -ne 0) { throw 'Unable to stage the repository.' }
& npm run check:publication
if ($LASTEXITCODE -ne 0) { throw 'Staged publication safety check failed.' }

& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  & git commit -m 'Initial public release: LoadChat v1.1.0'
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the initial commit.' }
}

$Origin = & git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0 -or -not $Origin) {
  & gh repo create $Repository --public --source=. --remote=origin --push --description $Description
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create or push the GitHub repository.' }
} else {
  & git push --set-upstream origin main
  if ($LASTEXITCODE -ne 0) { throw 'Unable to push the main branch.' }
}

& gh repo edit $Repository --enable-issues --enable-wiki=false --add-topic lan --add-topic chat --add-topic file-transfer --add-topic vue3 --add-topic socket-io --add-topic sqlite --add-topic pwa --add-topic self-hosted
if ($LASTEXITCODE -ne 0) { throw 'Repository was pushed, but its metadata could not be updated.' }

& gh api --method PUT "repos/$Repository/private-vulnerability-reporting"
if ($LASTEXITCODE -ne 0) { Write-Warning 'Enable private vulnerability reporting manually in repository security settings.' }

if ($PublishRelease) {
  & git rev-parse 'v1.1.0'
  if ($LASTEXITCODE -ne 0) { & git tag -a 'v1.1.0' -m 'LoadChat v1.1.0' }
  & git push origin 'v1.1.0'
  if ($LASTEXITCODE -ne 0) { throw 'Repository was published, but the v1.1.0 tag could not be pushed.' }
}

Write-Host "Published: https://github.com/$Repository" -ForegroundColor Green
