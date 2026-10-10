import { createHash } from "node:crypto";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Client as DonationsClient, Keypair, contract } from "@clearfun/sdk";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const rpcUrl = process.env.SOROBAN_RPC_URL;
const networkPassphrase = process.env.NETWORK_PASSPHRASE;
const contractId = process.env.CONTRACT_ID;
const tokenId = process.env.TOKEN_XLM_ID;
const orgSecret = process.env.SMOKE_ORG_SECRET;
const donorOneSecret = process.env.SMOKE_DONOR_SECRET;
const donorTwoSecret = process.env.SMOKE_DONOR_2_SECRET;
const donorThreeSecret = process.env.SMOKE_DONOR_3_SECRET;

if (
  !rpcUrl ||
  !networkPassphrase ||
  !contractId ||
  !tokenId ||
  !orgSecret ||
  !donorOneSecret ||
  !donorTwoSecret ||
  !donorThreeSecret
) {
  throw new Error(
    "Set CONTRACT_ID, TOKEN_XLM_ID, SMOKE_ORG_SECRET, SMOKE_DONOR_SECRET, SMOKE_DONOR_2_SECRET, and SMOKE_DONOR_3_SECRET.",
  );
}

const tokenContractId = tokenId;
const organization = Keypair.fromSecret(orgSecret);
const donorOne = Keypair.fromSecret(donorOneSecret);
const donorTwo = Keypair.fromSecret(donorTwoSecret);
const donorThree = Keypair.fromSecret(donorThreeSecret);
const accounts = [organization, donorOne, donorTwo, donorThree];
if (new Set(accounts.map((account) => account.publicKey())).size !== accounts.length) {
  throw new Error("Demo organization and donor accounts must be distinct.");
}
const signers = new Map(
  accounts.map((account) => [
    account.publicKey(),
    new contract.KeypairSigner(account, networkPassphrase),
  ]),
);
const organizationSigner = signers.get(organization.publicKey());
if (!organizationSigner) throw new Error("Could not create the organization signer.");

const client = new DonationsClient({
  contractId,
  networkPassphrase,
  rpcUrl,
  publicKey: organization.publicKey(),
  signTransaction: organizationSigner,
});

const windowSecs = 90n;
const xlm = 10_000_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400);

async function submit<T>(
  operation: string,
  transaction: contract.AssembledTransaction<contract.Result<T>>,
): Promise<T> {
  for (const address of transaction.needsNonInvokerSigningBy()) {
    const signer = signers.get(address);
    if (!signer) throw new Error(`${operation} requires an unavailable signer.`);
    await transaction.signAuthEntries({ address, signAuthEntry: signer });
  }
  const sent = await transaction.signAndSend({
    signTransaction: organizationSigner,
  });
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error(`${operation} completed without a transaction hash.`);
  const result = sent.result;
  if (result.isErr()) {
    throw new Error(`${operation} failed: ${result.unwrapErr().message}`);
  }
  console.log(`${operation}: ${hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${hash}`);
  return result.unwrap();
}

async function createCampaign(
  title: string,
  slug: string,
  milestones: Array<[string, bigint]>,
): Promise<number> {
  return submit(
    `${slug}: campaign_created`,
    await client.create_campaign({
      org: organization.publicKey(),
      token: tokenContractId,
      title,
      description_uri: `https://example.org/clearfund-demo/${slug}`,
      milestones: milestones.map(([description, amount]) => [
        description,
        amount,
      ] as const),
      window_secs: windowSecs,
      deadline,
    }),
  );
}

async function donate(
  campaignId: number,
  donor: Keypair,
  amount: bigint,
  label: string,
): Promise<void> {
  await submit(
    `${label}: donated`,
    await client.donate({
      donor: donor.publicKey(),
      campaign_id: campaignId,
      amount,
    }),
  );
}

async function submitEvidence(
  campaignId: number,
  index: number,
  label: string,
): Promise<void> {
  const hash = createHash("sha256")
    .update(`ClearFund demo evidence: ${label}:${campaignId}:${index}`)
    .digest();
  await submit(
    `${label}: evidence_submitted`,
    await client.submit_evidence({
      campaign_id: campaignId,
      milestone_index: index,
      evidence_hash: hash,
      evidence_uri: `https://example.org/clearfund-demo/evidence/${campaignId}/${index}`,
    }),
  );
}

async function waitForWindow(campaignId: number, index: number): Promise<void> {
  const milestone = (await client.get_milestone({
    campaign_id: campaignId,
    milestone_index: index,
  })).result.unwrap();
  const remaining = 90;
  if (remaining > 0) {
    console.log(`Waiting ${remaining} seconds for campaign ${campaignId} milestone ${index + 1}.`);
    await new Promise((resolve) => setTimeout(resolve, (remaining + 25) * 1000));
  }
}

const completedId = await createCampaign(
  "Agua potable para una escuela rural",
  "agua-escuela-rural",
  [
    ["Perforación y análisis del pozo", 4n * xlm],
    ["Bomba y filtros", 6n * xlm],
  ],
);
await donate(completedId, donorOne, 2n * xlm, "completed campaign donor one");
await donate(completedId, donorTwo, 8n * xlm, "completed campaign donor two");
await submitEvidence(completedId, 0, "completed campaign milestone one");
const exited = await submit(
  "completed campaign: donor exited",
  await client.withdraw({
    donor: donorOne.publicKey(),
    campaign_id: completedId,
  }),
);
if (exited !== 2n * xlm) {
  throw new Error("Demo donor exit did not return that donor's full position.");
}
await donate(completedId, donorTwo, 2n * xlm, "completed campaign replacement donation");
await waitForWindow(completedId, 0);
await submit(
  "completed campaign: milestone one released",
  await client.release_milestone({
    campaign_id: completedId,
    milestone_index: 0,
  }),
);
await submitEvidence(completedId, 1, "completed campaign milestone two");
await waitForWindow(completedId, 1);
await submit(
  "completed campaign: milestone two released and bond returned",
  await client.release_milestone({
    campaign_id: completedId,
    milestone_index: 1,
  }),
);

const openWindowId = await createCampaign(
  "Kits escolares para una comunidad",
  "kits-escolares",
  [
    ["Compra de materiales", 10n * xlm],
    ["Entrega documentada", 10n * xlm],
  ],
);
await donate(openWindowId, donorThree, 10n * xlm, "open window campaign");
await submitEvidence(openWindowId, 0, "open window campaign milestone one");

const newCampaignId = await createCampaign(
  "Reparación de la sede comunitaria",
  "sede-comunitaria",
  [
    ["Reparación del techo", 5n * xlm],
    ["Terminaciones y reapertura", 5n * xlm],
  ],
);

console.log(
  `Seed complete: completed=${completedId}, open_window=${openWindowId}, new=${newCampaignId}. No wallet secrets were emitted.`,
);



