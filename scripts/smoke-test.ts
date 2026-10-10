import { createHash } from "node:crypto";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Client as DonationsClient, Keypair, contract } from "@clearfun/sdk";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const rpcUrl = process.env.SOROBAN_RPC_URL;
const networkPassphrase = process.env.NETWORK_PASSPHRASE;
const contractId = process.env.CONTRACT_ID;
const tokenId = process.env.TOKEN_XLM_ID;
const deployerSecret = process.env.DEPLOYER_SECRET;
const orgSecret = process.env.SMOKE_ORG_SECRET;
const donorOneSecret = process.env.SMOKE_DONOR_SECRET;
const donorTwoSecret = process.env.SMOKE_DONOR_2_SECRET;

if (
  !rpcUrl ||
  !networkPassphrase ||
  !contractId ||
  !tokenId ||
  !deployerSecret ||
  !orgSecret ||
  !donorOneSecret ||
  !donorTwoSecret
) {
  throw new Error(
    "Set CONTRACT_ID, TOKEN_XLM_ID, DEPLOYER_SECRET, SMOKE_ORG_SECRET, SMOKE_DONOR_SECRET, and SMOKE_DONOR_2_SECRET.",
  );
}

const deployer = Keypair.fromSecret(deployerSecret);
const organization = Keypair.fromSecret(orgSecret);
const donorOne = Keypair.fromSecret(donorOneSecret);
const donorTwo = Keypair.fromSecret(donorTwoSecret);
const signers = new Map(
  [deployer, organization, donorOne, donorTwo].map((keypair) => [
    keypair.publicKey(),
    new contract.KeypairSigner(keypair, networkPassphrase),
  ]),
);
const deployerSigner = signers.get(deployer.publicKey());
if (!deployerSigner) throw new Error("Could not create the deployer signer.");

const client = new DonationsClient({
  contractId,
  networkPassphrase,
  rpcUrl,
  publicKey: deployer.publicKey(),
  signTransaction: deployerSigner,
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
  publicKey: deployer.publicKey(),
});

async function submitTransaction<T>(
  name: string,
  tx: contract.AssembledTransaction<T>,
): Promise<T> {
  for (const address of tx.needsNonInvokerSigningBy()) {
    const signer = signers.get(address);
    if (!signer) throw new Error(`${name} requires an unavailable signer.`);
    await tx.signAuthEntries({ address, signAuthEntry: signer });
  }
  const sent = await tx.signAndSend({ signTransaction: deployerSigner });
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error(`${name} completed without a transaction hash.`);
  const result: unknown = sent.result;
  if (
    typeof result === "object" &&
    result !== null &&
    "isErr" in result &&
    typeof result.isErr === "function"
  ) {
    const contractResult = result as contract.Result<unknown>;
    if (contractResult.isErr()) {
      throw new Error(`${name} failed: ${contractResult.unwrapErr().message}`);
    }
  }
  console.log(`${name}: ${hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${hash}`);
  return sent.result;
}

const unwrap = <T>(result: contract.Result<T>): T => result.unwrap();
const balance = async (account: string) =>
  (await tokenClient.balance({ id: account })).result;
const initialOrgBalance = await balance(organization.publicKey());
const initialContractBalance = await balance(contractId);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
const milestoneAmount = 100_000n;
const campaignId = unwrap(
  await submitTransaction(
    "campaign_created",
    await client.create_campaign(
      {
        org: organization.publicKey(),
        token: tokenId,
        title: "ClearFund individual donor exit smoke",
        description_uri: "https://example.org/clearfund-smoke",
        milestones: [
          ["First milestone", milestoneAmount],
          ["Second milestone", milestoneAmount],
        ],
        window_secs: 60n,
        deadline,
      },
      { publicKey: deployer.publicKey() },
    ),
  ),
);
console.log(`Campaign ID: ${campaignId}`);

await submitTransaction(
  "donated_donor_one",
  await client.donate(
    {
      donor: donorOne.publicKey(),
      campaign_id: campaignId,
      amount: 50_000n,
    },
    { publicKey: deployer.publicKey() },
  ),
);
await submitTransaction(
  "donated_donor_two",
  await client.donate(
    {
      donor: donorTwo.publicKey(),
      campaign_id: campaignId,
      amount: 150_000n,
    },
    { publicKey: deployer.publicKey() },
  ),
);

const evidenceHash = createHash("sha256")
  .update(`ClearFund public evidence window for campaign ${campaignId}`)
  .digest();
await submitTransaction(
  "evidence_submitted_milestone_1",
  await client.submit_evidence(
    {
      campaign_id: campaignId,
      milestone_index: 0,
      evidence_hash: evidenceHash,
      evidence_uri: "https://example.org/clearfund-smoke/evidence-1",
    },
    { publicKey: deployer.publicKey() },
  ),
);
const donorOneExit = unwrap(
  await submitTransaction(
    "exited_donor_one",
    await client.withdraw(
      { donor: donorOne.publicKey(), campaign_id: campaignId },
      { publicKey: deployer.publicKey() },
    ),
  ),
);
if (donorOneExit !== 50_000n) {
  throw new Error(`Donor one withdrew ${donorOneExit}; expected 50000.`);
}

await submitTransaction(
  "donated_donor_two_after_exit",
  await client.donate(
    {
      donor: donorTwo.publicKey(),
      campaign_id: campaignId,
      amount: 50_000n,
    },
    { publicKey: deployer.publicKey() },
  ),
);

async function waitForMilestoneWindow(milestoneIndex: number): Promise<void> {
  const milestone = unwrap(
    (
      await client.get_milestone(
        { campaign_id: campaignId, milestone_index: milestoneIndex },
        { publicKey: deployer.publicKey() },
      )
    ).result,
  );
  const remaining = 60;
  if (remaining > -20) {
    console.log(`Waiting ${remaining} seconds for milestone ${milestoneIndex + 1}.`);
    await new Promise((resolve) => setTimeout(resolve, (remaining + 25) * 1000));
  }
}

const orgBalanceBeforeRelease = await balance(organization.publicKey());
const contractBalanceBeforeRelease = await balance(contractId);
if (
  orgBalanceBeforeRelease - initialOrgBalance + 20_000n !== 0n ||
  contractBalanceBeforeRelease - initialContractBalance !== 220_000n
) {
  throw new Error("Smoke test balances do not match the bond and donations.");
}

await waitForMilestoneWindow(0);
await submitTransaction(
  "milestone_released_1",
  await client.release_milestone(
    { campaign_id: campaignId, milestone_index: 0 },
    { publicKey: deployer.publicKey() },
  ),
);
const orgBalanceAfterFirstRelease = await balance(organization.publicKey());
if (orgBalanceAfterFirstRelease - orgBalanceBeforeRelease !== milestoneAmount) {
  throw new Error("The organization did not receive exactly milestone one.");
}
const firstCampaign = unwrap(
  (
    await client.get_campaign(
      { campaign_id: campaignId },
      { publicKey: deployer.publicKey() },
    )
  ).result,
);
if (
  firstCampaign.total_released !== milestoneAmount ||
  firstCampaign.held !== milestoneAmount
) {
  throw new Error("Milestone one release did not reconcile with remaining held funds.");
}

const secondEvidenceHash = createHash("sha256")
  .update(`ClearFund public evidence for campaign ${campaignId}, milestone 2`)
  .digest();
await submitTransaction(
  "evidence_submitted_milestone_2",
  await client.submit_evidence(
    {
      campaign_id: campaignId,
      milestone_index: 1,
      evidence_hash: secondEvidenceHash,
      evidence_uri: "https://example.org/clearfund-smoke/evidence-2",
    },
    { publicKey: deployer.publicKey() },
  ),
);
await waitForMilestoneWindow(1);
await submitTransaction(
  "milestone_released_2",
  await client.release_milestone(
    { campaign_id: campaignId, milestone_index: 1 },
    { publicKey: deployer.publicKey() },
  ),
);

const finalCampaign = unwrap(
  (
    await client.get_campaign(
      { campaign_id: campaignId },
      { publicKey: deployer.publicKey() },
    )
  ).result,
);
const finalOrgBalance = await balance(organization.publicKey());
const finalContractBalance = await balance(contractId);
if (
  finalCampaign.status.tag !== "Completed" ||
  finalCampaign.total_released !== 200_000n ||
  finalCampaign.bond_state.tag !== "Returned" ||
  finalOrgBalance - initialOrgBalance !== 200_000n ||
  finalContractBalance !== initialContractBalance
) {
  throw new Error("Smoke test final campaign state or token balances do not reconcile.");
}

console.log(
  `Smoke test passed: campaign ${campaignId}; releases=200000; bond returned=${finalCampaign.bond_amount}; contract balance restored.`,
);





