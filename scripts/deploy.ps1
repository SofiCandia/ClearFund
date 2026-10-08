$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$envPath = Join-Path $root ".env"

if (Test-Path $envPath) {
    foreach ($line in Get-Content $envPath) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim()
            if ($value.Length -ge 2 -and
                (($value.StartsWith('"') -and $value.EndsWith('"')) -or
                    ($value.StartsWith("'") -and $value.EndsWith("'")))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if (-not [Environment]::GetEnvironmentVariable($name)) {
                [Environment]::SetEnvironmentVariable($name, $value)
            }
        }
    }
}

if (-not $env:DEPLOYER_SECRET) {
    throw "Set DEPLOYER_SECRET in the environment or .env."
}

if (-not $env:NETWORK_PASSPHRASE) {
    $env:NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
}
if (-not $env:SOROBAN_RPC_URL) {
    $env:SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org"
}

pnpm --filter @clearfun/sdk build
if ($LASTEXITCODE -ne 0) { throw "SDK build failed." }

stellar contract build
if ($LASTEXITCODE -ne 0) { throw "Soroban contract build failed." }

$deploymentOutput = & stellar contract deploy `
    --wasm target\wasm32v1-none\release\donations.wasm `
    --source-account $env:DEPLOYER_SECRET `
    --network testnet `
    --network-passphrase $env:NETWORK_PASSPHRASE `
    --rpc-url $env:SOROBAN_RPC_URL `
    --optimize `
    --alias clearfun-donations 2>&1
$deploymentExitCode = $LASTEXITCODE
$deploymentOutput | Write-Output
if ($deploymentExitCode -ne 0) { throw "Contract deployment failed." }

$contractIds = @()
foreach ($line in $deploymentOutput) {
    if ("$line" -match '^\s*(C[A-Z2-7]{55})\s*$') {
        $contractIds += $Matches[1]
    }
}
if ($contractIds.Count -eq 0) {
    throw "Could not resolve the deployed contract ID."
}
$contractId = $contractIds[-1]

$adminAddress = (pnpm --filter @clearfun/scripts exec tsx key-address.ts | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $adminAddress -notmatch '^G[A-Z2-7]{55}$') {
    throw "Could not derive the admin account address."
}

stellar contract invoke `
    --id $contractId `
    --source-account $env:DEPLOYER_SECRET `
    --network testnet `
    --network-passphrase $env:NETWORK_PASSPHRASE `
    --rpc-url $env:SOROBAN_RPC_URL `
    -- initialize --admin $adminAddress
if ($LASTEXITCODE -ne 0) { throw "Contract initialize failed." }

if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $root ".env.example") $envPath
}
$lines = [System.Collections.Generic.List[string]]::new()
$found = $false
foreach ($line in Get-Content $envPath) {
    if ($line -match '^CONTRACT_ID=') {
        $lines.Add("CONTRACT_ID=$contractId")
        $found = $true
    } else {
        $lines.Add($line)
    }
}
if (-not $found) { $lines.Add("CONTRACT_ID=$contractId") }
Set-Content -Path $envPath -Value $lines -Encoding utf8

Write-Output "Contract deployed and initialized: $contractId"
Write-Output "Explorer: https://stellar.expert/explorer/testnet/contract/$contractId"
