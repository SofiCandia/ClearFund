#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  inherited_deployer_secret="${DEPLOYER_SECRET:-}"
  inherited_passphrase="${NETWORK_PASSPHRASE:-}"
  inherited_rpc_url="${SOROBAN_RPC_URL:-}"
  inherited_contract_id="${CONTRACT_ID:-}"
  inherited_legacy_contract_id="${LEGACY_CONTRACT_ID:-}"
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
  DEPLOYER_SECRET="${inherited_deployer_secret:-${DEPLOYER_SECRET:-}}"
  NETWORK_PASSPHRASE="${inherited_passphrase:-${NETWORK_PASSPHRASE:-}}"
  SOROBAN_RPC_URL="${inherited_rpc_url:-${SOROBAN_RPC_URL:-}}"
  CONTRACT_ID="${inherited_contract_id:-${CONTRACT_ID:-}}"
  LEGACY_CONTRACT_ID="${inherited_legacy_contract_id:-${LEGACY_CONTRACT_ID:-}}"
fi

: "${DEPLOYER_SECRET:?Set DEPLOYER_SECRET in the environment or .env}"
prior_contract_id="${CONTRACT_ID:-}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"

stellar contract build
stellar contract bindings typescript \
  --wasm target/wasm32v1-none/release/donations.wasm \
  --output-dir packages/sdk \
  --overwrite
node -e 'const fs=require("node:fs");const p="packages/sdk/package.json";const j=JSON.parse(fs.readFileSync(p,"utf8"));j.name="@clearfun/sdk";j.version="0.1.0";j.exports="./dist/index.js";j.types="dist/index.d.ts";j.scripts={build:"tsc --project tsconfig.json"};fs.writeFileSync(p,JSON.stringify(j,null,2)+"\n")'
pnpm --filter @clearfun/sdk build

deploy_output="$(
  stellar contract deploy \
    --wasm target/wasm32v1-none/release/donations.wasm \
    --source-account "$DEPLOYER_SECRET" \
    --network testnet \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL" \
    --optimize \
    --alias clearfun-donations 2>&1
)" || {
  printf '%s\n' "$deploy_output" >&2
  exit 1
}
printf '%s\n' "$deploy_output"
CONTRACT_ID="$(printf '%s\n' "$deploy_output" | grep -E '^C[A-Z2-7]{55}$' | tail -n 1)"
if [[ -z "$CONTRACT_ID" ]]; then
  echo "Could not extract the contract ID from Stellar CLI output." >&2
  exit 1
fi

INITIALIZER_ADDRESS="$(./scripts/node_modules/.bin/tsx scripts/key-address.ts)"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$DEPLOYER_SECRET" \
  --network testnet \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url "$RPC_URL" \
  -- initialize --bond-bps 1000 --initializer "$INITIALIZER_ADDRESS"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
previous_contract_id="$prior_contract_id"
if [[ -f .env ]]; then
  temporary_env="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      CONTRACT_ID=*)
        value="${line#CONTRACT_ID=}"
        if [[ -n "$value" ]]; then previous_contract_id="$value"; fi
        ;;
    esac
  done < .env
  awk '!/^CONTRACT_ID=/ && !/^LEGACY_CONTRACT_ID=/' .env > "$temporary_env"
  mv "$temporary_env" .env
else
  : > .env
fi
printf '\nCONTRACT_ID=%s\n' "$CONTRACT_ID" >> .env
legacy_id="${previous_contract_id:-${LEGACY_CONTRACT_ID:-}}"
if [[ -n "$legacy_id" ]]; then
  printf 'LEGACY_CONTRACT_ID=%s\n' "$legacy_id" >> .env
fi

printf 'Contract deployed and initialized: %s\n' "$CONTRACT_ID"
printf 'Explorer: https://stellar.expert/explorer/testnet/contract/%s\n' "$CONTRACT_ID"
