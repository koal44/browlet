param([ValidateSet('prepare', 'collect')] [string] $Phase = 'prepare')

$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This script configures disposable GitHub Actions runners only.' }
$diagnostics = Join-Path $env:RUNNER_TEMP 'browlet-unit-diagnostics'

if ($Phase -eq 'prepare') {
  New-Item -ItemType Directory -Path $diagnostics -Force | Out-Null
  [DateTime]::UtcNow.ToString('o') | Set-Content (Join-Path $diagnostics 'started.txt')
  "BROWLET_TEST_DIAGNOSTICS=$diagnostics" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
  $reportPath = $diagnostics.Replace('\', '/')
  $reportOptions = "--report-on-fatalerror --report-exclude-env --report-exclude-network --report-directory=`"$reportPath`""
  # GitHub forbids assigning NODE_OPTIONS through GITHUB_ENV; unit steps apply this output explicitly.
  "node-options=$env:NODE_OPTIONS $reportOptions" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append

  if ($IsWindows) {
    # https://learn.microsoft.com/en-us/windows/win32/wer/collecting-user-mode-dumps
    # Keep up to three minidumps, avoiding full multi-gigabyte heaps.
    $dumps = 'HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe'
    New-Item -Path $dumps -Force | Out-Null
    New-ItemProperty -Path $dumps -Name DumpFolder -Value $diagnostics -PropertyType ExpandString -Force | Out-Null
    New-ItemProperty -Path $dumps -Name DumpType -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $dumps -Name DumpCount -Value 3 -PropertyType DWord -Force | Out-Null
  }
} elseif ($IsWindows -and (Test-Path -LiteralPath (Join-Path $diagnostics 'started.txt'))) {
  $started = [DateTime]::Parse((Get-Content (Join-Path $diagnostics 'started.txt')))
  # Event 1000 names the faulting module/offset even when no dump was produced.
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000, 1001; StartTime = $started } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match '\bnode\.exe\b' } |
    Select-Object TimeCreated, Id, Message)
  ConvertTo-Json -InputObject $events -Depth 4 | Set-Content (Join-Path $diagnostics 'windows-events.json')
}
