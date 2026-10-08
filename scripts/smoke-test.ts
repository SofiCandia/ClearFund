import { createHash } from "node:crypto";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Client as DonationsClient, Keypair, contract } from "@clearfun/sdk";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const rpcUrl = process.env.SOROBAN_RPC_URL;
const networkPassphrase = process.env.NETWORK_PASSPHRASE;
const contractId = process.env.CONTRACT_ID;
const tokenId = process.env.TOKEN_XLM_ID;
const adminSecret = process.env.DEPLOYER_SECRET;
const orgSecret = process.env.SMOKE_ORG_SECRET;
const donorSecret = process.env.SMOKE_DONOR_SECRET;
const verifierOneSecret = process.env.SMOKE_VERIFIER_1_SECRET;
const verifierTwoSecret = process.env.SMOKE_VERIFIER_2_SECRET;

if (
  !rpcUrl ||
  !networkPassphrase ||
  !contractId ||
  !tokenId ||
  !adminSecret ||
  !orgSecret ||
  !donorSecret ||
  !verifierOneSecret ||
  !verifierTwoSecret
) {
  throw new Error(
    "Set CONTRACT_ID, TOKEN_XLM_ID, DEPLOYER_SECRET, SMOKE_ORG_SECRET, SMOKE_DONOR_SECRET, SMOKE_VERIFIER_1_SECRET, and SMOKE_VERIFIER_2_SECRET.",
  );
}

const admin = Keypair.fromSecret(adminSecret);
const organization = Keypair.fromSecret(orgSecret);
const donor = Keypair.fromSecret(donorSecret);
const verifierOne = Keypair.fromSecret(verifierOneSecret);
const verifierTwo = Keypair.fromSecret(verifierTwoSecret);
const signers = new Map(
  [admin, organization, donor, verifierOne, verifierTwo].map((keypair) => [
    keypair.publicKey(),
    new contract.KeypairSigner(keypair, networkPassphrase),
  ]),
);
const adminSigner = signers.get(admin.publicKey());
if (!adminSigner) {
  throw new Error("Could not create the admin transaction signer.");
}

const client = new DonationsClient({
  contractId,
  networkPassphrase,
  rpcUrl,
  publicKey: admin.publicKey(),
  signTransaction: adminSigner,
});

interface TokenClient {
  balance: (args: {
    id: string;
  }) => Promise<contract.AssembledTransaction<bigint>>;
}

const tokenClient = await contract.Client.from<TokenClient>({
  contractId: tokenId,
  networkPassphrase,
  rpcUrl,
  publicKey: admin.publicKey(),
});

async function submitTransaction<T>(
  name: string,
  tx: contract.AssembledTransaction<T>,
): Promise<T> {
  for (const address of tx.needsNonInvokerSigningBy()) {
    const signer = signers.get(address);
    if (!signer) {
      throw new Error(`${name} requires an unavailable signer: ${address}`);
    }
    await tx.signAuthEntries({
      address,
      signAuthEntry: signer,
    });
  }

  const sent = await tx.signAndSend({ signTransaction: adminSigner });
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error(`${name} completed without a transaction hash.`);
  }
  const result: unknown = sent.result;
  if (
    typeof result === "object" &&
    result !== null &&
    "isErr" in result &&
    typeof result.isErr === "function"
  ) {
    const returnedResult = result as contract.Result<unknown>;
    if (returnedResult.isErr()) {
      throw new Error(`${name} failed: ${returnedResult.unwrapErr().message}`);
    }
  }
  console.log(`${name}: ${hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${hash}`);
  return sent.result;
}

const unwrap = <T>(result: contract.Result<T>): T => result.unwrap();
const balanceBefore = (
  await tokenClient.balance({ id: organization.publicKey() })
).result;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const amount = 100_000n;

const campaignId = unwrap(
  await submitTransaction(
    "campaign_created",
    await client.create_campaign(
      {
        org: organization.publicKey(),
        token: tokenId,
        title: "ClearFun testnet smoke campaign",
        description_uri: "https://example.org/clearfun-smoke",
        milestones: [["Smoke-test milestone", amount]],
        verifiers: [verifierOne.publicKey(), verifierTwo.publicKey()],
        threshold: 2,
        deadline,
      },
      { publicKey: admin.publicKey() },
    ),
  ),
);
console.log(`Campaign ID: ${campaignId}`);

await submitTransaction(
  "donated",
  await client.donate(
    {
      donor: donor.publicKey(),
      campaign_id: campaignId,
      amount,
    },
    { publicKey: admin.publicKey() },
  ),
);

const evidenceHash = createHash("sha256")
  .update(`ClearFun testnet evidence for campaign ${campaignId}`)
  .digest();
await submitTransaction(
  "evidence_submitted",
  await client.submit_evidence(
    {
      campaign_id: campaignId,
      milestone_index: 0,
      evidence_hash: evidenceHash,
      evidence_uri: "https://example.org/clearfun-smoke/evidence",
    },
    { publicKey: admin.publicKey() },
  ),
);

await submitTransaction(
  "milestone_approved (verifier 1/2)",
  await client.approve_milestone(
    {
      verifier: verifierOne.publicKey(),
      campaign_id: campaignId,
      milestone_index: 0,
    },
    { publicKey: admin.publicKey() },
  ),
);
await submitTransaction(
  "milestone_approved (verifier 2/2) and milestone_released",
  await client.approve_milestone(
    {
      verifier: verifierTwo.publicKey(),
      campaign_id: campaignId,
      milestone_index: 0,
    },
    { publicKey: admin.publicKey() },
  ),
);

const campaign = unwrap(
  (
    await client.get_campaign(
      { campaign_id: campaignId },
      { publicKey: admin.publicKey() },
    )
  ).result,
);
const balanceAfter = (
  await tokenClient.balance({ id: organization.publicKey() })
).result;

if (
  campaign.total_released !== amount ||
  campaign.milestones[0]?.status.tag !== "Released" ||
  balanceAfter - balanceBefore !== amount
) {
  throw new Error(
    `Smoke verification failed: released=${campaign.total_released}, org balance delta=${balanceAfter - balanceBefore}.`,
  );
}

console.log(
  `Smoke test passed: campaign ${campaignId}; organization received ${amount} stroops from token ${tokenId}.`,
);
