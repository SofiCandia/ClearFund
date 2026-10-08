#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  inherited_deployer_secret="${DEPLOYER_SECRET:-}"
  inherited_passphrase="${NETWORK_PASSPHRASE:-}"
  inherited_rpc_url="${SOROBAN_RPC_URL:-}"
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
  DEPLOYER_SECRET="${inherited_deployer_secret:-${DEPLOYER_SECRET:-}}"
  NETWORK_PASSPHRASE="${inherited_passphrase:-${NETWORK_PASSPHRASE:-}}"
  SOROBAN_RPC_URL="${inherited_rpc_url:-${SOROBAN_RPC_URL:-}}"
fi

: "${DEPLOYER_SECRET:?Set DEPLOYER_SECRET in the environment or .env}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"

pnpm --filter @clearfun/sdk build
stellar contract build

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

ADMIN_ADDRESS="$(pnpm --filter @clearfun/scripts exec tsx key-address.ts)"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$DEPLOYER_SECRET" \
  --network testnet \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url "$RPC_URL" \
  -- initialize --admin "$ADMIN_ADDRESS"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
if grep -q '^CONTRACT_ID=' .env; then
  sed -i.bak "s|^CONTRACT_ID=.*|CONTRACT_ID=$CONTRACT_ID|" .env
  rm -f .env.bak
else
  printf '\nCONTRACT_ID=%s\n' "$CONTRACT_ID" >> .env
fi

printf 'Contract deployed and initialized: %s\n' "$CONTRACT_ID"
printf 'Explorer: https://stellar.expert/explorer/testnet/contract/%s\n' "$CONTRACT_ID"
