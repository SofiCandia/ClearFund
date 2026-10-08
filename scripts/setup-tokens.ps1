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

$tokenXlmId = (stellar contract id asset `
    --asset native `
    --network testnet `
    --network-passphrase $env:NETWORK_PASSPHRASE `
    --rpc-url $env:SOROBAN_RPC_URL | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $tokenXlmId -notmatch '^C[A-Z2-7]{55}$') {
    throw "Could not derive the native XLM SAC contract ID."
}

stellar contract invoke `
    --id $tokenXlmId `
    --source-account $env:DEPLOYER_SECRET `
    --network testnet `
    --network-passphrase $env:NETWORK_PASSPHRASE `
    --rpc-url $env:SOROBAN_RPC_URL `
    --send no -- name *> $null
if ($LASTEXITCODE -ne 0) {
    stellar contract asset deploy `
        --asset native `
        --source-account $env:DEPLOYER_SECRET `
        --network testnet `
        --network-passphrase $env:NETWORK_PASSPHRASE `
        --rpc-url $env:SOROBAN_RPC_URL
    if ($LASTEXITCODE -ne 0) { throw "Could not deploy native XLM SAC." }
}

$tokenUsdcId = ""
if ($env:USDC_ISSUER_ADDRESS) {
    if ($env:USDC_ISSUER_ADDRESS -notmatch '^G[A-Z2-7]{55}$') {
        throw "USDC_ISSUER_ADDRESS must be a Stellar G... public key."
    }
    $asset = "USDC:$($env:USDC_ISSUER_ADDRESS)"
    $tokenUsdcId = (stellar contract id asset `
        --asset $asset `
        --network testnet `
        --network-passphrase $env:NETWORK_PASSPHRASE `
        --rpc-url $env:SOROBAN_RPC_URL | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not derive the test USDC SAC contract ID." }

    stellar contract invoke `
        --id $tokenUsdcId `
        --source-account $env:DEPLOYER_SECRET `
        --network testnet `
        --network-passphrase $env:NETWORK_PASSPHRASE `
        --rpc-url $env:SOROBAN_RPC_URL `
        --send no -- name *> $null
    if ($LASTEXITCODE -ne 0) {
        stellar contract asset deploy `
            --asset $asset `
            --source-account $env:DEPLOYER_SECRET `
            --network testnet `
            --network-passphrase $env:NETWORK_PASSPHRASE `
            --rpc-url $env:SOROBAN_RPC_URL
        if ($LASTEXITCODE -ne 0) { throw "Could not deploy the test USDC SAC." }
    }
} else {
    Write-Output "USDC_ISSUER_ADDRESS is unset; skipping test USDC SAC."
}

if (-not (Test-Path $envPath)) {
    Copy-Item (Join-Path $root ".env.example") $envPath
}
$values = @{
    TOKEN_XLM_ID = $tokenXlmId
    TOKEN_USDC_ID = $tokenUsdcId
}
$lines = [System.Collections.Generic.List[string]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new()
foreach ($line in Get-Content $envPath) {
    if ($line -match '^(TOKEN_XLM_ID|TOKEN_USDC_ID)=') {
        $name = $Matches[1]
        $lines.Add("$name=$($values[$name])")
        [void]$seen.Add($name)
    } else {
        $lines.Add($line)
    }
}
foreach ($name in $values.Keys) {
    if (-not $seen.Contains($name)) { $lines.Add("$name=$($values[$name])") }
}
Set-Content -Path $envPath -Value $lines -Encoding utf8

Write-Output "TOKEN_XLM_ID=$tokenXlmId"
Write-Output "XLM SAC: https://stellar.expert/explorer/testnet/contract/$tokenXlmId"
if ($tokenUsdcId) {
    Write-Output "TOKEN_USDC_ID=$tokenUsdcId"
    Write-Output "USDC SAC: https://stellar.expert/explorer/testnet/contract/$tokenUsdcId"
}
