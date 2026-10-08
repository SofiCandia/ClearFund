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
const verifierOneSecret = process.env.SMOKE_VERIFIER_1_SECRET;
const verifierTwoSecret = process.env.SMOKE_VERIFIER_2_SECRET;

if (
  !rpcUrl ||
  !networkPassphrase ||
  !contractId ||
  !tokenId ||
  !orgSecret ||
  !donorOneSecret ||
  !donorTwoSecret ||
  !donorThreeSecret ||
  !verifierOneSecret ||
  !verifierTwoSecret
) {
  throw new Error(
    "Set CONTRACT_ID, TOKEN_XLM_ID, SMOKE_ORG_SECRET, SMOKE_DONOR_SECRET, SMOKE_DONOR_2_SECRET, SMOKE_DONOR_3_SECRET, SMOKE_VERIFIER_1_SECRET, and SMOKE_VERIFIER_2_SECRET.",
  );
}

const organization = Keypair.fromSecret(orgSecret);
const donorOne = Keypair.fromSecret(donorOneSecret);
const donorTwo = Keypair.fromSecret(donorTwoSecret);
const donorThree = Keypair.fromSecret(donorThreeSecret);
const verifierOne = Keypair.fromSecret(verifierOneSecret);
const verifierTwo = Keypair.fromSecret(verifierTwoSecret);
const actorAddresses = [
  organization,
  donorOne,
  donorTwo,
  donorThree,
  verifierOne,
  verifierTwo,
].map((keypair) => keypair.publicKey());
if (new Set(actorAddresses).size !== actorAddresses.length) {
  throw new Error(
    "The organization, three donors, and two verifiers must use distinct accounts.",
  );
}
const signers = new Map(
  [organization, donorOne, donorTwo, donorThree, verifierOne, verifierTwo].map(
    (keypair) => [
      keypair.publicKey(),
      new contract.KeypairSigner(keypair, networkPassphrase),
    ],
  ),
);
const organizationSigner = signers.get(organization.publicKey());

if (!organizationSigner) {
  throw new Error("Could not create the organization transaction signer.");
}

const client = new DonationsClient({
  contractId,
  networkPassphrase,
  rpcUrl,
  publicKey: organization.publicKey(),
  signTransaction: organizationSigner,
});

const stroops = 10_000_000n;
const deadline = BigInt(Math.floor(Date.now() / 1000) + 180 * 24 * 60 * 60);

interface SeedCampaign {
  slug: string;
  title: string;
  milestones: Array<{ description: string; amount: bigint }>;
  donations: Array<{ donor: Keypair; amount: bigint }>;
}

const waterMilestoneOne = {
  description: "Perforación y análisis del pozo",
  amount: 6n * stroops,
};
const waterMilestoneTwo = {
  description: "Instalación de bomba y filtros",
  amount: 9n * stroops,
};
const waterSeed: SeedCampaign = {
  slug: "agua-escuela-rural",
  title: "Agua potable para escuela rural",
  milestones: [waterMilestoneOne, waterMilestoneTwo],
  donations: [
    { donor: donorOne, amount: 5n * stroops },
    { donor: donorTwo, amount: 4n * stroops },
    { donor: donorThree, amount: 6n * stroops },
  ],
};
const schoolMilestoneOne = {
  description: "Compra de kits escolares",
  amount: 8n * stroops,
};
const schoolMilestoneTwo = {
  description: "Entrega documentada a 200 niños",
  amount: 12n * stroops,
};
const schoolSeed: SeedCampaign = {
  slug: "utiles-escolares-200-ninos",
  title: "Útiles escolares para 200 niños",
  milestones: [schoolMilestoneOne, schoolMilestoneTwo],
  donations: [
    { donor: donorOne, amount: 3n * stroops },
    { donor: donorTwo, amount: 4n * stroops },
    { donor: donorThree, amount: 3n * stroops },
  ],
};
const communityMilestoneOne = {
  description: "Retiro de material dañado y reparación del techo",
  amount: 4n * stroops,
};
const communityMilestoneTwo = {
  description: "Terminaciones y reapertura comunitaria",
  amount: 8n * stroops,
};
const communitySeed: SeedCampaign = {
  slug: "reconstruccion-sede-vecinal",
  title: "Reconstrucción de sede vecinal",
  milestones: [communityMilestoneOne, communityMilestoneTwo],
  donations: [
    { donor: donorTwo, amount: 1n * stroops },
    { donor: donorThree, amount: 2n * stroops },
  ],
};
const campaigns = [waterSeed, schoolSeed, communitySeed];

function unwrapResult<T>(result: contract.Result<T>, operation: string): T {
  if (result.isErr()) {
    throw new Error(`${operation} failed: ${result.unwrapErr().message}`);
  }
  return result.unwrap();
}

async function submit<T>(
  operation: string,
  transaction: contract.AssembledTransaction<contract.Result<T>>,
): Promise<T> {
  for (const address of transaction.needsNonInvokerSigningBy()) {
    const signer = signers.get(address);
    if (!signer) {
      throw new Error(
        `${operation} requires an unavailable signer: ${address}`,
      );
    }
    await transaction.signAuthEntries({
      address,
      signAuthEntry: signer,
    });
  }

  const sent = await transaction.signAndSend({
    signTransaction: organizationSigner,
  });
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error(`${operation} completed without a transaction hash.`);
  }
  const result = unwrapResult(sent.result, operation);
  console.log(`${operation}: ${hash}`);
  console.log(`https://stellar.expert/explorer/testnet/tx/${hash}`);
  return result;
}

async function submitEvidence(
  campaignId: number,
  slug: string,
  milestoneIndex: number,
  description: string,
): Promise<void> {
  const evidenceHash = createHash("sha256")
    .update(`ClearFun demo evidence: ${slug}: ${description}`)
    .digest();
  const hashHex = evidenceHash.toString("hex");
  const evidenceUri = `https://example.org/clearfun-demo/evidence/${slug}-${milestoneIndex}-${hashHex}.pdf`;

  await submit(
    `${slug}: evidence for milestone ${milestoneIndex + 1}`,
    await client.submit_evidence({
      campaign_id: campaignId,
      milestone_index: milestoneIndex,
      evidence_hash: evidenceHash,
      evidence_uri: evidenceUri,
    }),
  );
}

const initialCount = (await client.get_campaign_count()).result;
const campaignIds: number[] = [];

for (const campaign of campaigns) {
  const campaignId = await submit(
    `${campaign.slug}: create campaign`,
    await client.create_campaign({
      org: organization.publicKey(),
      token: tokenId,
      title: campaign.title,
      description_uri: `https://example.org/clearfun-demo/campaigns/${campaign.slug}`,
      milestones: campaign.milestones.map(
        (milestone) => [milestone.description, milestone.amount] as const,
      ),
      verifiers: [verifierOne.publicKey(), verifierTwo.publicKey()],
      threshold: 2,
      deadline,
    }),
  );
  campaignIds.push(campaignId);
  console.log(
    `Campaign ${campaignId}: ${campaign.title}; goal ${campaign.milestones.reduce((sum, milestone) => sum + milestone.amount, 0n)} stroops.`,
  );

  for (const donation of campaign.donations) {
    await submit(
      `${campaign.slug}: donation from ${donation.donor.publicKey()}`,
      await client.donate({
        donor: donation.donor.publicKey(),
        campaign_id: campaignId,
        amount: donation.amount,
      }),
    );
  }
}

const [waterCampaignId, schoolCampaignId, communityCampaignId] = campaignIds;
if (
  waterCampaignId === undefined ||
  schoolCampaignId === undefined ||
  communityCampaignId === undefined
) {
  throw new Error("Seed campaign creation did not return all campaign IDs.");
}

await submitEvidence(
  waterCampaignId,
  waterSeed.slug,
  0,
  waterMilestoneOne.description,
);
await submit(
  "water campaign: verifier 1 approves milestone 1",
  await client.approve_milestone({
    verifier: verifierOne.publicKey(),
    campaign_id: waterCampaignId,
    milestone_index: 0,
  }),
);
await submit(
  "water campaign: verifier 2 approves and releases milestone 1",
  await client.approve_milestone({
    verifier: verifierTwo.publicKey(),
    campaign_id: waterCampaignId,
    milestone_index: 0,
  }),
);
await submitEvidence(
  waterCampaignId,
  waterSeed.slug,
  1,
  waterMilestoneTwo.description,
);
await submit(
  "water campaign: verifier 1 approves milestone 2",
  await client.approve_milestone({
    verifier: verifierOne.publicKey(),
    campaign_id: waterCampaignId,
    milestone_index: 1,
  }),
);
await submit(
  "water campaign: verifier 2 approves, releases, and completes",
  await client.approve_milestone({
    verifier: verifierTwo.publicKey(),
    campaign_id: waterCampaignId,
    milestone_index: 1,
  }),
);

await submitEvidence(
  schoolCampaignId,
  schoolSeed.slug,
  0,
  schoolMilestoneOne.description,
);
await submit(
  "school campaign: one of two verifiers approves milestone 1",
  await client.approve_milestone({
    verifier: verifierOne.publicKey(),
    campaign_id: schoolCampaignId,
    milestone_index: 0,
  }),
);

const [waterCampaign, schoolCampaign, communityCampaign] = await Promise.all(
  campaignIds.map(async (campaignId) =>
    unwrapResult(
      (await client.get_campaign({ campaign_id: campaignId })).result,
      `Read campaign ${campaignId}`,
    ),
  ),
);

if (
  waterCampaign?.status.tag !== "Completed" ||
  waterCampaign.total_released !== 15n * stroops ||
  waterCampaign.milestones.some(
    (milestone) => milestone.status.tag !== "Released",
  )
) {
  throw new Error(
    "The water campaign did not complete all milestone releases.",
  );
}
if (
  schoolCampaign?.status.tag !== "Active" ||
  schoolCampaign.total_raised !== 10n * stroops ||
  schoolCampaign.milestones[0]?.status.tag !== "EvidenceSubmitted" ||
  schoolCampaign.milestones[0].approvals.length !== 1
) {
  throw new Error("The school campaign is not in its intended halfway state.");
}
if (
  communityCampaign?.status.tag !== "Active" ||
  communityCampaign.total_raised !== 3n * stroops
) {
  throw new Error("The community campaign did not remain partially funded.");
}

console.log(
  JSON.stringify(
    {
      seeded_campaigns: [
        {
          id: waterCampaign.id,
          title: waterCampaign.title,
          raised_stroops: waterCampaign.total_raised.toString(),
          released_stroops: waterCampaign.total_released.toString(),
          status: waterCampaign.status.tag,
        },
        {
          id: schoolCampaign.id,
          title: schoolCampaign.title,
          raised_stroops: schoolCampaign.total_raised.toString(),
          released_stroops: schoolCampaign.total_released.toString(),
          status: schoolCampaign.status.tag,
        },
        {
          id: communityCampaign.id,
          title: communityCampaign.title,
          raised_stroops: communityCampaign.total_raised.toString(),
          released_stroops: communityCampaign.total_released.toString(),
          status: communityCampaign.status.tag,
        },
      ],
      explorer:
        "https://stellar.expert/explorer/testnet/contract/" + contractId,
      first_campaign_id: initialCount + 1,
    },
    null,
    2,
  ),
);
