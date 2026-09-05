param(
  [ValidateSet('24.19.0', '26.8.1')]
  [string]$Version = '24.19.0'
)

$ErrorActionPreference = 'Stop'
$compatCache = Join-Path $PSScriptRoot '../.cache'
$compatDirectory = Join-Path $compatCache "node-v$Version"
New-Item -ItemType Directory -Force -Path (Join-Path $compatDirectory 'Release') | Out-Null
# Official https://nodejs.org/dist/v<version>/SHASUMS256.txt.
$compatHashes = @{
  '24.19.0' = @{
    Headers = '54f14a297d47ea0794fe272363703d9dc419c96ac68f20d890f98b63754a3e4c'
    Library = '63ec831bbf164d1b23197d6fac1944dfb146534e332889ca0755d250e8dedff9'
    Executable = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
  }
  '26.8.1' = @{
    Headers = 'e4f54decdbf7eadb121c39c050f04f5430a7af1d035bb8ded501171637fe72de'
    Library = '5432dceeac196ef89ec001939cc3801cfa131036a05f5fabf5e07b6c5a0895a4'
    Executable = '5cba0ea928508c65ddadefc0681d2fb6d95f1f3beea4428f04397631140ee8e5'
  }
}[$Version]
$compatArtifacts = @(
  @{ Remote = 'win-x64/node.lib'; Local = 'Release/node.lib'; Hash = $compatHashes.Library }
  @{ Remote = 'win-x64/node.exe'; Local = 'node.exe'; Hash = $compatHashes.Executable }
)
foreach ($compatArtifact in $compatArtifacts) {
  $compatPath = Join-Path $compatDirectory $compatArtifact.Local
  if (-not (Test-Path -LiteralPath $compatPath)) {
    Invoke-WebRequest -Uri ("https://nodejs.org/dist/v$Version/" + $compatArtifact.Remote) -OutFile $compatPath
  }
  if ((Get-FileHash -LiteralPath $compatPath -Algorithm SHA256).Hash -ne $compatArtifact.Hash) {
    throw ('Hash mismatch: ' + $compatArtifact.Local)
  }
}
$compatArchive = New-TemporaryFile
try {
  Invoke-WebRequest -Uri "https://nodejs.org/dist/v$Version/node-v$Version-headers.tar.gz" -OutFile $compatArchive.FullName
  if ((Get-FileHash -LiteralPath $compatArchive.FullName -Algorithm SHA256).Hash -ne $compatHashes.Headers) {
    throw "Hash mismatch: Node $Version headers"
  }
  tar -xf $compatArchive.FullName -C $compatCache
  if ($LASTEXITCODE -ne 0) { throw 'Header extraction failed' }
} finally {
  Remove-Item -LiteralPath $compatArchive.FullName
}
Write-Output "Verified and prepared Node $Version development files."
