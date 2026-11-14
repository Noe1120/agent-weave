param([string]$Dotnet = '')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if(!$Dotnet){$Dotnet=Join-Path $root '.tools/dotnet/dotnet.exe'}
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1';$env:DOTNET_NOLOGO='1'
& $Dotnet build packages/runner/RunnerHost.csproj -c Release -o artifacts/runner-host
if($LASTEXITCODE -ne 0){throw 'RunnerHost build failed'}
