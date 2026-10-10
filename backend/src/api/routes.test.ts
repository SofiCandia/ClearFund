import { createHash } from "node:crypto";
import type { StorageProvider } from "../storage/storage-provider.js";
import type { TransactionService } from "../transactions/transaction-service.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { IndexerDatabase } from "../indexer/database.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const CONTRACT_ID = "CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI";
const TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ORG = "GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN";
const DONOR = "GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY";
const RELEASE_HASH =
  "a4e4abb92f25d7e09f47e0d80a98a86d108a71c48e724f54cbbddac5223732cb";
const evidenceFile = Buffer.from("%PDF-1.7\nClearFun evidence\n");
const evidenceHash = createHash("sha256").update(evidenceFile).digest("hex");

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const databases: IndexerDatabase[] = [];

class MemoryStorageProvider implements StorageProvider {
  readonly files = new Map<string, Buffer>();

  async save(hash: string, data: Buffer): Promise<string> {
    this.files.set(hash, Buffer.from(data));
    return `/evidence/${hash}`;
  }

  async read(hash: string): Promise<Buffer> {
    const file = this.files.get(hash);
    if (!file) {
      const error = new Error("Not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return Buffer.from(file);
  }

  async exists(hash: string): Promise<boolean> {
    return this.files.has(hash);
  }
}

function makeDatabase(): IndexerDatabase {
  const database = new IndexerDatabase(":memory:");
  databases.push(database);
  database.connection
    .prepare(
      `INSERT INTO campaigns (
        id, org, token, title, description_uri, goal, deadline, window_secs,
        bond_amount, bond_state, total_raised, total_released, total_withdrawn,
        held, total_shares, epoch, status, updated_ledger
      ) VALUES (1, ?, ?, 'ClearFun campaign', 'https://example.org/campaign',
        '1000', 2000000000, 60, '10', 'Held', '500', '100', '10',
        '390', '500', 0, 'Active', 100)`,
    )
    .run(ORG, TOKEN_ID);
  database.connection
    .prepare(
      `INSERT INTO milestones (
        campaign_id, milestone_index, description, amount, status,
        evidence_hash, evidence_uri, window_end, released_amount, updated_ledger
      ) VALUES (1, 0, 'First milestone', '500', 'EvidenceSubmitted', ?,
        'https://api.clearfun.test/evidence', ?, '0', 100)`,
    )
    .run(evidenceHash, Math.floor(Date.now() / 1000) + 300);
  database.connection
    .prepare(
      `INSERT INTO donations (
        campaign_id, donor, amount, shares, withdrawn, position_epoch, updated_ledger
      ) VALUES (1, ?, '500', '500', '10', 0, 100)`,
    )
    .run(DONOR);
  const eventStatement = database.connection.prepare(
    `INSERT INTO events
     (event_id, tx_hash, ledger, timestamp, type, payload_json, explorer_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  eventStatement.run(
    "event-campaign-created",
    "1".repeat(64),
    100,
    "2026-10-07T12:00:00.000Z",
    "campaign_created",
    JSON.stringify({ topics: ["campaign_created", 1], value: {} }),
    `https://stellar.expert/explorer/testnet/tx/${"1".repeat(64)}`,
  );
  eventStatement.run(
    "event-donated",
    "2".repeat(64),
    101,
    "2026-10-07T12:00:05.000Z",
    "donated",
    JSON.stringify({
      topics: ["donated", 1, DONOR],
      value: { amount: "500", shares: "500" },
    }),
    `https://stellar.expert/explorer/testnet/tx/${"2".repeat(64)}`,
  );
  eventStatement.run(
    "event-released",
    RELEASE_HASH,
    102,
    "2026-10-07T12:00:10.000Z",
    "milestone_released",
    JSON.stringify({
      topics: ["milestone_released", 1, 0],
      value: { amount: "100" },
    }),
    `https://stellar.expert/explorer/testnet/tx/${RELEASE_HASH}`,
  );
  return database;
}

function makeApp(allowedOrigins = "") {
  const database = makeDatabase();
  const storageProvider = new MemoryStorageProvider();
  const queryContract = vi.fn(async (contractId: string, method: string) => {
    if (method === "get_campaign") {
      return {
        result: {
          value: {
            id: 1,
            org: ORG,
            token: TOKEN_ID,
            goal: "1000",
            total_raised: "500",
            total_released: "100",
            total_withdrawn: "10",
            held: "390",
          },
        },
        isReadCall: true,
      };
    }
    if (method === "balance" && contractId === TOKEN_ID) {
      return { result: { value: 400n }, isReadCall: true };
    }
    throw new Error(`Unexpected RPC method ${method}`);
  });
  const rpcClient = {
    queryContract,
  } as unknown as import("@stellar/stellar-sdk").rpc.Server;
  const transactionService = {
    createCampaign: vi.fn(async () => "unsigned-create-xdr"),
    donate: vi.fn(async () => "unsigned-donate-xdr"),
    submitEvidence: vi.fn(async () => "unsigned-evidence-xdr"),
    withdraw: vi.fn(async () => "unsigned-withdraw-xdr"),
    releaseMilestone: vi.fn(async () => "unsigned-release-xdr"),
    reclaimBond: vi.fn(async () => "unsigned-bond-xdr"),
    submitSignedXdr: vi.fn(async () => ({
      hash: RELEASE_HASH,
      status: "SUCCESS",
      explorer_url: `https://stellar.expert/explorer/testnet/tx/${RELEASE_HASH}`,
    })),
  } satisfies Pick<
    TransactionService,
    | "createCampaign"
    | "donate"
    | "submitEvidence"
    | "withdraw"
    | "releaseMilestone"
    | "reclaimBond"
    | "submitSignedXdr"
  >;
  const config = loadConfig({
    CONTRACT_ID,
    EVIDENCE_STORAGE_DIR: "./data/test-evidence",
    ALLOWED_ORIGINS: allowedOrigins,
  });
  const app = buildApp({
    config,
    database,
    rpcServer: rpcClient,
    transactionService,
    storageProvider,
  });
  apps.push(app);
  return { app, database, storageProvider, queryContract, transactionService };
}

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const database of databases.splice(0)) database.close();
});

describe("ClearFun REST API", () => {
  it("allows explicitly configured CORS origins and supports a development wildcard", async () => {
    const allowedOrigin = "https://app.base44.example";
    const { app: allowlistedApp } = makeApp(allowedOrigin);
    const allowed = await allowlistedApp.inject({
      method: "GET",
      url: "/health",
      headers: { origin: allowedOrigin },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe(allowedOrigin);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const externalOrigin = "https://preview.base44.example";
    const { app: wildcardApp } = makeApp("*");
    const wildcard = await wildcardApp.inject({
      method: "GET",
      url: "/health",
      headers: { origin: externalOrigin },
    });
    expect(wildcard.headers["access-control-allow-origin"]).toBe(
      externalOrigin,
    );
  });

  it("serves health, paginated campaigns, campaign details, donations, timeline, donor history, and statistics", async () => {
    const { app } = makeApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    const campaigns = await app.inject({
      method: "GET",
      url: "/campaigns?status=Active&page=1&limit=10&search=clearfun",
    });
    const campaign = await app.inject({
      method: "GET",
      url: "/campaigns/1",
    });
    const donations = await app.inject({
      method: "GET",
      url: "/campaigns/1/donations",
    });
    const timeline = await app.inject({
      method: "GET",
      url: "/campaigns/1/timeline",
    });
    const donorHistory = await app.inject({
      method: "GET",
      url: `/donors/${DONOR}/donations`,
    });
    const stats = await app.inject({ method: "GET", url: "/stats" });

    expect(health.json()).toEqual({ status: "ok" });
    expect(health.headers["x-content-type-options"]).toBe("nosniff");
    expect(campaigns.json().data).toHaveLength(1);
    expect(campaign.json()).toMatchObject({
      id: 1,
      progress_percent: 49,
      funded: "490",
      held: "390",
      bond_amount: "10",
      milestones: [
        {
          index: 0,
          status: "EvidenceSubmitted",
          window_end: expect.any(Number),
        },
      ],
    });
    expect(donations.json().data[0]).toMatchObject({
      donor: DONOR,
      amount: "500",
      shares: "500",
      current_value: "390",
      withdrawn: "10",
      withdrawable: true,
    });
    expect(timeline.json().data).toHaveLength(3);
    expect(timeline.json().data[2]).toMatchObject({
      type: "milestone_released",
      tx_hash: RELEASE_HASH,
      explorer_url: `https://stellar.expert/explorer/testnet/tx/${RELEASE_HASH}`,
    });
    expect(donorHistory.json().data[0]).toMatchObject({
      campaign_id: 1,
      title: "ClearFun campaign",
    });
    expect(stats.json()).toEqual({
      total_donated: "500",
      campaign_count: 1,
      donor_count: 1,
      total_released: "100",
    });
  });

  it("reports indexed and live Soroban escrow accounting", async () => {
    const { app, queryContract } = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/campaigns/1/audit",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accounting: {
        total_donated: "500",
        total_released: "100",
        total_withdrawn: "10",
        held: "390",
      },
      on_chain: {
        total_raised: "500",
        total_released: "100",
        total_withdrawn: "10",
        held: "390",
      },
      consistent: true,
    });
    expect(queryContract).toHaveBeenCalledTimes(1);
  });

  it("checks solvency per token across all new-contract campaigns", async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/audit/solvency",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      consistent: true,
      tokens: [
        {
          token: TOKEN_ID,
          contract_balance: "400",
          expected_balance: "400",
          campaign_count: 1,
          campaigns: [
            {
              campaign_id: 1,
              held: "390",
              bond_amount: "10",
              bond_state: "Held",
            },
          ],
          consistent: true,
        },
      ],
    });
  });

  it("validates query and path inputs with uniform error envelopes", async () => {
    const { app } = makeApp();
    const invalidId = await app.inject({
      method: "GET",
      url: "/campaigns/not-an-id",
    });
    const missing = await app.inject({
      method: "GET",
      url: "/campaigns/99",
    });
    const invalidSearch = await app.inject({
      method: "GET",
      url: "/campaigns?page=0",
    });

    expect(invalidId.statusCode).toBe(400);
    expect(invalidId.json().error.code).toBe("INVALID_REQUEST");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("CAMPAIGN_NOT_FOUND");
    expect(invalidSearch.statusCode).toBe(400);
  });

  it("prepares unsigned wallet transactions and submits signed envelopes", async () => {
    const { app, transactionService } = makeApp();
    const requests = [
      [
        "/tx/create-campaign",
        {
          source: ORG,
          org: ORG,
          token: TOKEN_ID,
          title: "New campaign",
          description_uri: "https://example.org/new",
          milestones: [{ description: "Phase one", amount: "100" }],
          window_seconds: 60,
          deadline: "1800000000",
        },
      ],
      [
        "/tx/donate",
        { source: DONOR, donor: DONOR, campaign_id: 1, amount: "100" },
      ],
      [
        "/tx/submit-evidence",
        {
          campaign_id: 1,
          milestone_index: 0,
          evidence_hash: evidenceHash,
          evidence_uri: "https://example.org/evidence",
        },
      ],
      ["/tx/withdraw", { source: DONOR, donor: DONOR, campaign_id: 1 }],
      ["/tx/claim-refund", { source: DONOR, donor: DONOR, campaign_id: 1 }],
      [
        "/tx/release-milestone",
        { source: ORG, campaign_id: 1, milestone_index: 0 },
      ],
      ["/tx/reclaim-bond", { campaign_id: 1 }],
    ] as const;

    for (const [url, body] of requests) {
      const response = await app.inject({ method: "POST", url, payload: body });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ signed: false });
      expect(response.json().xdr).toContain("unsigned-");
    }
    const removedApproval = await app.inject({
      method: "POST",
      url: "/tx/approve-milestone",
      payload: {},
    });
    expect(removedApproval.statusCode).toBe(410);
    expect(removedApproval.json().error.code).toBe("ENDPOINT_REMOVED");
    const submitted = await app.inject({
      method: "POST",
      url: "/tx/submit",
      payload: { xdr: "wallet-signed-envelope" },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({
      hash: RELEASE_HASH,
      status: "SUCCESS",
    });
    expect(transactionService.submitSignedXdr).toHaveBeenCalledWith(
      "wallet-signed-envelope",
    );
    const invalidCampaign = await app.inject({
      method: "POST",
      url: "/tx/create-campaign",
      payload: {
        source: ORG,
        org: ORG,
        token: TOKEN_ID,
        title: "Invalid window",
        description_uri: "https://example.org/invalid",
        milestones: [{ description: "Phase one", amount: "100" }],
        window_seconds: 30,
        deadline: "1800000000",
      },
    });
    expect(invalidCampaign.statusCode).toBe(400);
    expect(invalidCampaign.json().error.code).toBe("INVALID_REQUEST");
    expect(transactionService.createCampaign).toHaveBeenCalledTimes(1);
  });

  it("uploads, serves, and verifies evidence against its on-chain milestone record", async () => {
    const { app, storageProvider } = makeApp();
    const boundary = "----clearfun-evidence-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      evidenceFile,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const upload = await app.inject({
      method: "POST",
      url: "/evidence/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    const downloaded = await app.inject({
      method: "GET",
      url: `/evidence/${evidenceHash}`,
    });
    const verification = await app.inject({
      method: "GET",
      url: `/evidence/${evidenceHash}/verify`,
    });

    expect(upload.statusCode).toBe(201);
    expect(upload.json()).toMatchObject({
      hash: evidenceHash,
      uri: `/evidence/${evidenceHash}`,
      content_type: "application/pdf",
    });
    expect(storageProvider.files.has(evidenceHash)).toBe(true);
    expect(downloaded.headers["content-type"]).toContain("application/pdf");
    expect(downloaded.rawPayload).toEqual(evidenceFile);
    expect(verification.json()).toMatchObject({
      file_matches_hash: true,
      on_chain: true,
      campaign_id: 1,
      milestone_index: 0,
      verified: true,
    });
  });

  it("rejects evidence with an unsupported or spoofed media type", async () => {
    const { app } = makeApp();
    const boundary = "----clearfun-bad-evidence-boundary";
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="evidence.txt"\r\nContent-Type: text/plain\r\n\r\nnot allowed\r\n--${boundary}--\r\n`,
    );
    const response = await app.inject({
      method: "POST",
      url: "/evidence/upload",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("serves the OpenAPI document and exposes schemas for the transaction workflow", async () => {
    const { app } = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/docs/openapi.json",
    });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.info.title).toBe("ClearFun API");
    expect(
      document.paths["/tx/create-campaign"].post.requestBody.content[
        "application/json"
      ].schema.properties.milestones,
    ).toBeDefined();
    expect(
      document.paths["/evidence/upload"].post.requestBody.content[
        "multipart/form-data"
      ].schema.properties.file.format,
    ).toBe("binary");
    expect(
      document.paths["/campaigns"].get.parameters.find(
        (parameter: { name: string }) => parameter.name === "page",
      ).required,
    ).toBe(false);
  });
});
