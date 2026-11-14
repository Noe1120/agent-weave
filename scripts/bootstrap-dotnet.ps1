param([string]$Destination = '.tools/dotnet')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$target=[IO.Path]::GetFullPath((Join-Path $root $Destination))
if(!$target.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'SDK must stay within the workspace'}
$version='10.0.404'
$url='https://builds.dotnet.microsoft.com/dotnet/Sdk/10.0.404/dotnet-sdk-10.0.404-win-x64.zip'
$sha='330ddd2665b43cd2e428216a0d8ea1ac7bb19b5434fdc530e62010dc3b52823a620bf95489d628e1ed6f5122401793ee4887cca4a019122361a1231497f632ee'
$exe=Join-Path $target 'dotnet.exe'
if(Test-Path -LiteralPath $exe){if((& $exe --version) -ne $version){throw 'Existing SDK version mismatch; existing directory left intact'};Write-Output "SDK $version already present";exit 0}
New-Item -ItemType Directory -Force $target | Out-Null
$zip=Join-Path (Split-Path $target -Parent) 'dotnet-sdk.zip'
if(!(Test-Path -LiteralPath $zip) -or (Get-FileHash -LiteralPath $zip -Algorithm SHA512).Hash -ne $sha){Invoke-WebRequest $url -OutFile $zip}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA512).Hash -ne $sha){throw 'SDK SHA512 mismatch; archive not extracted'}
Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
if((& $exe --version) -ne $version){throw 'Extracted SDK version mismatch'}
Write-Output "SDK ready: $exe"
