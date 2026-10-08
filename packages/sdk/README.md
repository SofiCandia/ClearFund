# `@clearfun/sdk`

Generated TypeScript bindings for the ClearFun Soroban donation contract.
The bindings use `@stellar/stellar-sdk` and include the typed contract client,
contract data types, result types, and event specifications.

## Build

From the monorepo root:

```powershell
stellar contract build
stellar contract bindings typescript --wasm target\wasm32v1-none\release\donations.wasm --output-dir packages\sdk --overwrite
pnpm install
pnpm --filter @clearfun/sdk build
```

The CLI generation command overwrites generated package metadata, so restore the
monorepo package name and TypeScript build configuration from the workspace
version-control copy before using it as a workspace package.

## Use

```ts
import { Client } from "@clearfun/sdk";

const client = new Client({
  contractId: process.env.CONTRACT_ID!,
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  publicKey: accountPublicKey,
  signTransaction: walletSigner,
});
```

Each generated write method simulates and returns an assembled transaction.
Sign its authorization entries for any non-invoker accounts, then call
`signAndSend()` with a transaction signer.
