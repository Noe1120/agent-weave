param([Parameter(Mandatory=$true)][int]$TargetId,
      [Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
$process = Get-Process -Id $TargetId
# Open and retain the actual process handle before signalling readiness; no PID polling.
$null = $process.Handle
$started = $process.StartTime.ToUniversalTime().ToString('o')
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($OutputFile + '.ready', $started, $utf8)
if (-not $process.WaitForExit(60000)) { throw 'OWNED_EXIT_TIMEOUT' }
$record = @{ exit_observed=$true; exit_code=$process.ExitCode; started_at=$started; observed_at=[DateTime]::UtcNow.ToString('o') }
[IO.File]::WriteAllText($OutputFile, ($record | ConvertTo-Json -Compress), $utf8)
$process.Dispose()
