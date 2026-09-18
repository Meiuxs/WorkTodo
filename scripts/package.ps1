$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'manifest.json'
$distPath = Join-Path $repoRoot 'dist'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Extension manifest not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.version)) {
  throw 'manifest.json must contain a valid version field.'
}

New-Item -ItemType Directory -Force -Path $distPath | Out-Null
$archivePath = Join-Path $distPath ("WorkTodo-v{0}.zip" -f $manifest.version)

if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
  Remove-Item -LiteralPath $archivePath -Force
}

$archiveInputs = @(
  (Join-Path $repoRoot 'manifest.json'),
  (Join-Path $repoRoot 'src')
)

Compress-Archive -Path $archiveInputs -DestinationPath $archivePath -CompressionLevel Optimal

$archive = Get-Item -LiteralPath $archivePath
Write-Output ("Created extension package: {0} ({1:N0} bytes)" -f $archive.FullName, $archive.Length)
