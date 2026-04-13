# validate-cli-bin.ps1
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$binValue = $pkg.bin.'solo-cto-agent'
if (-not $binValue) { Write-Error "bin entry missing"; exit 1 }
$binValue = $binValue -replace '\\','/'
if ($binValue -match '^\./') { $binValue = $binValue.Substring(2) }
if (-not (Test-Path $binValue)) { Write-Error "bin target missing: $binValue"; exit 1 }
Write-Host "bin ok: $binValue"
