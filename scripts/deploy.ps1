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

stellar contract build
if ($LASTEXITCODE -ne 0) { throw "Soroban contract build failed." }

$bindingOutput = & stellar contract bindings typescript `
    --wasm target\wasm32v1-none\release\donations.wasm `
    --output-dir packages\sdk `
    --overwrite 2>&1
if ($LASTEXITCODE -ne 0) {
    $bindingOutput | Write-Output
    throw "SDK binding generation failed."
}

$package = Get-Content (Join-Path $root "packages\sdk\package.json") -Raw | ConvertFrom-Json
$package.name = "@clearfun/sdk"
$package.version = "0.1.0"
$package.exports = "./dist/index.js"
$package.types = "dist/index.d.ts"
$package.scripts.build = "tsc --project tsconfig.json"
$package | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $root "packages\sdk\package.json") -Encoding utf8

pnpm.cmd --filter @clearfun/sdk build
if ($LASTEXITCODE -ne 0) { throw "SDK build failed." }

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

$tsx = Join-Path $root "scripts\node_modules\.bin\tsx.cmd"
$keyAddressScript = Join-Path $root "scripts\key-address.ts"
$initializerAddress = (& $tsx $keyAddressScript | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $initializerAddress -notmatch '^G[A-Z2-7]{55}$') {
    throw "Could not derive the initializer account address."
}

stellar contract invoke `
    --id $contractId `
    --source-account $env:DEPLOYER_SECRET `
    --network testnet `
    --network-passphrase $env:NETWORK_PASSPHRASE `
    --rpc-url $env:SOROBAN_RPC_URL `
    -- initialize --bond-bps 1000 --initializer $initializerAddress
if ($LASTEXITCODE -ne 0) { throw "Contract initialize failed." }

if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $root ".env.example") $envPath
}
$lines = [System.Collections.Generic.List[string]]::new()
$found = $false
$previousContractId = $null
$previousLegacyId = $env:LEGACY_CONTRACT_ID
foreach ($line in Get-Content $envPath) {
    if ($line -match '^CONTRACT_ID=') {
        if ($line -match '^CONTRACT_ID=(.+)$' -and $Matches[1] -ne $contractId) {
            $previousContractId = $Matches[1]
        }
        $lines.Add("CONTRACT_ID=$contractId")
        $found = $true
    } elseif ($line -match '^LEGACY_CONTRACT_ID=') {
        continue
    } else {
        $lines.Add($line)
    }
}
if (-not $found) { $lines.Add("CONTRACT_ID=$contractId") }
$legacyContractId = if ($previousContractId) { $previousContractId } else { $previousLegacyId }
if ($legacyContractId) { $lines.Add("LEGACY_CONTRACT_ID=$legacyContractId") }
Set-Content -Path $envPath -Value $lines -Encoding utf8

Write-Output "Contract deployed and initialized: $contractId"
Write-Output "Explorer: https://stellar.expert/explorer/testnet/contract/$contractId"
