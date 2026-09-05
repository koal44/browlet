$ErrorActionPreference = 'Stop'
$compatCache = Join-Path $PSScriptRoot '../.cache'
$compatDownloads = Join-Path $compatCache 'downloads'
New-Item -ItemType Directory -Force -Path $compatDownloads | Out-Null
# Official https://nodejs.org/dist/v24.19.0/SHASUMS256.txt.
$compatArtifacts = @(
  @{ Remote = 'node-v24.19.0-headers.tar.gz'; Local = 'node-v24.19.0-headers.tar.gz'; Hash = '54f14a297d47ea0794fe272363703d9dc419c96ac68f20d890f98b63754a3e4c' },
  @{ Remote = 'win-x64/node.lib'; Local = 'node-v24.19.0-win-x64.lib'; Hash = '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9' }
)
foreach ($compatArtifact in $compatArtifacts) {
  $compatPath = Join-Path $compatDownloads $compatArtifact.Local
  if (-not (Test-Path -LiteralPath $compatPath)) {
    Invoke-WebRequest -Uri ('https://nodejs.org/dist/v24.19.0/' + $compatArtifact.Remote) -OutFile $compatPath
  }
  if ((Get-FileHash -LiteralPath $compatPath -Algorithm SHA256).Hash -ne $compatArtifact.Hash) {
    throw ('Hash mismatch: ' + $compatArtifact.Local)
  }
}
tar -xf (Join-Path $compatDownloads 'node-v24.19.0-headers.tar.gz') -C $compatCache
if ($LASTEXITCODE -ne 0) { throw 'Header extraction failed' }
$compatLibraryDirectory = Join-Path $compatCache 'node-v24.19.0/Release'
New-Item -ItemType Directory -Force -Path $compatLibraryDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $compatDownloads 'node-v24.19.0-win-x64.lib') -Destination (Join-Path $compatLibraryDirectory 'node.lib')
Write-Output 'Verified and prepared Node 24.19.0 headers and Windows x64 library.'
