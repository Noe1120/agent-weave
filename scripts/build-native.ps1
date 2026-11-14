param([string]$Dotnet = '',[string]$Node = '',[string]$Output = 'artifacts/Team-0.3.0-win-x64')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
if(!$Dotnet){$Dotnet=Join-Path $root '.tools/dotnet/dotnet.exe'}
if(!$Node){$Node=(Get-Command node -ErrorAction Stop).Source}
$Dotnet=[IO.Path]::GetFullPath($Dotnet);$Node=[IO.Path]::GetFullPath($Node);$out=[IO.Path]::GetFullPath((Join-Path $root $Output))
if(!$out.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Output must be within the workspace'}
$version=& $Node -p 'process.versions.node';if($LASTEXITCODE -ne 0 -or $version -ne '24.14.0'){throw 'Packaging is qualified for Node 24.14.0 only'}
$env:DOTNET_CLI_TELEMETRY_OPTOUT='1';$env:DOTNET_NOLOGO='1'
& $Node node_modules/typescript/bin/tsc -p tsconfig.build.json;if($LASTEXITCODE -ne 0){throw 'Service build failed'}
& $Node scripts/copy-assets.mjs;if($LASTEXITCODE -ne 0){throw 'Service assets failed'}
& $Dotnet publish packages/desktop/Team.csproj -c Release -r win-x64 --self-contained true -p:DebugType=None -p:DebugSymbols=false -o $out
if($LASTEXITCODE -ne 0){throw 'Native publish failed'}
New-Item -ItemType Directory -Force (Join-Path $out 'runtime'),(Join-Path $out 'service/packages'),(Join-Path $out 'service/node_modules'),(Join-Path $out 'licenses') | Out-Null
Copy-Item -LiteralPath $Node -Destination (Join-Path $out 'runtime/node.exe') -Force
Copy-Item -LiteralPath 'dist/packages/service' -Destination (Join-Path $out 'service/packages') -Recurse -Force
Copy-Item -LiteralPath 'dist/packages/contracts' -Destination (Join-Path $out 'service/packages') -Recurse -Force
$dependencies=& $Node -e "const l=require('./package-lock.json');for(const [p,v] of Object.entries(l.packages))if(p&&!v.dev&&p.startsWith('node_modules/'))console.log(p)"
if($LASTEXITCODE -ne 0){throw 'Could not read production dependency lock'}
foreach($dependency in $dependencies){
 $relative=$dependency.Substring(13)
 $destination=Join-Path $out ('service/node_modules/'+$relative)
 $parent=Split-Path $destination -Parent
 New-Item -ItemType Directory -Force $parent | Out-Null
 Copy-Item -LiteralPath $dependency -Destination $parent -Recurse -Force
}
[IO.File]::WriteAllText((Join-Path $out 'service/package.json'),'{"name":"team-native-service","private":true,"type":"module","version":"0.3.0"}')
Copy-Item -LiteralPath 'packages/desktop/README.md' -Destination (Join-Path $out '使用说明.md') -Force
Copy-Item -LiteralPath '.tools/dotnet/LICENSE.txt' -Destination (Join-Path $out 'licenses/dotnet-LICENSE.txt') -Force
Copy-Item -LiteralPath '.tools/dotnet/ThirdPartyNotices.txt' -Destination (Join-Path $out 'licenses/dotnet-ThirdPartyNotices.txt') -Force
$nodeLicense=Join-Path (Split-Path $Node -Parent) 'LICENSE'
if(Test-Path -LiteralPath $nodeLicense){Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $out 'licenses/node-LICENSE.txt') -Force}
else{Invoke-WebRequest 'https://raw.githubusercontent.com/nodejs/node/v24.14.0/LICENSE' -OutFile (Join-Path $out 'licenses/node-LICENSE.txt')}
& $Node scripts/native-manifest.mjs $out (& $Dotnet --version)
if($LASTEXITCODE -ne 0){throw 'Package manifest failed'}
& $Node tests/native-package.mjs $out;if($LASTEXITCODE -ne 0){throw 'Package verification failed'}
Write-Output "Native executable: $out\Team.exe"


