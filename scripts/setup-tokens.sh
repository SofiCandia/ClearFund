#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  inherited_deployer_secret="${DEPLOYER_SECRET:-}"
  inherited_passphrase="${NETWORK_PASSPHRASE:-}"
  inherited_rpc_url="${SOROBAN_RPC_URL:-}"
  inherited_usdc_issuer="${USDC_ISSUER_ADDRESS:-}"
  set -a
  # shellcheck disable=SC1091
  source ./.env
  set +a
  DEPLOYER_SECRET="${inherited_deployer_secret:-${DEPLOYER_SECRET:-}}"
  NETWORK_PASSPHRASE="${inherited_passphrase:-${NETWORK_PASSPHRASE:-}}"
  SOROBAN_RPC_URL="${inherited_rpc_url:-${SOROBAN_RPC_URL:-}}"
  USDC_ISSUER_ADDRESS="${inherited_usdc_issuer:-${USDC_ISSUER_ADDRESS:-}}"
fi

: "${DEPLOYER_SECRET:?Set DEPLOYER_SECRET in the environment or .env}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${SOROBAN_RPC_URL:-https://soroban-testnet.stellar.org}"

TOKEN_XLM_ID="$(
  stellar contract id asset \
    --asset native \
    --network testnet \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL"
)"
if ! stellar contract invoke \
  --id "$TOKEN_XLM_ID" \
  --source-account "$DEPLOYER_SECRET" \
  --network testnet \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --rpc-url "$RPC_URL" \
  --send no -- name >/dev/null 2>&1; then
  stellar contract asset deploy \
    --asset native \
    --source-account "$DEPLOYER_SECRET" \
    --network testnet \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL"
fi

TOKEN_USDC_ID=""
if [[ -n "${USDC_ISSUER_ADDRESS:-}" ]]; then
  if [[ ! "$USDC_ISSUER_ADDRESS" =~ ^G[A-Z2-7]{55}$ ]]; then
    echo "USDC_ISSUER_ADDRESS must be a Stellar G... public key." >&2
    exit 1
  fi
  USDC_ASSET="USDC:$USDC_ISSUER_ADDRESS"
  TOKEN_USDC_ID="$(
    stellar contract id asset \
      --asset "$USDC_ASSET" \
      --network testnet \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      --rpc-url "$RPC_URL"
  )"
  if ! stellar contract invoke \
    --id "$TOKEN_USDC_ID" \
    --source-account "$DEPLOYER_SECRET" \
    --network testnet \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL" \
    --send no -- name >/dev/null 2>&1; then
    stellar contract asset deploy \
      --asset "$USDC_ASSET" \
      --source-account "$DEPLOYER_SECRET" \
      --network testnet \
      --network-passphrase "$NETWORK_PASSPHRASE" \
      --rpc-url "$RPC_URL"
  fi
else
  echo "USDC_ISSUER_ADDRESS is unset; skipping test USDC SAC."
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi
for key in TOKEN_XLM_ID TOKEN_USDC_ID; do
  value="${!key}"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    rm -f .env.bak
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
done

printf 'TOKEN_XLM_ID=%s\n' "$TOKEN_XLM_ID"
printf 'XLM SAC: https://stellar.expert/explorer/testnet/contract/%s\n' "$TOKEN_XLM_ID"
if [[ -n "$TOKEN_USDC_ID" ]]; then
  printf 'TOKEN_USDC_ID=%s\n' "$TOKEN_USDC_ID"
  printf 'USDC SAC: https://stellar.expert/explorer/testnet/contract/%s\n' "$TOKEN_USDC_ID"
fi
