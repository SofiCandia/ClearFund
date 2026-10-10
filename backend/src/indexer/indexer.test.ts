import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IndexerDatabase } from "./database.js";
import {
  SorobanEventIndexer,
  type IndexerRpcClient,
  type RpcEvent,
} from "./indexer.js";

const CONTRACT_ID = "CAFXICHEYMOI42VUO3AH7UJ5DYHJ6GGPHDYVH2RS6ITR42JCM5MQI5FI";
const ORG = "GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN";
const DONOR = "GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY";
const evidence = Buffer.from("a".repeat(64), "hex");

const campaignSnapshot = {
  id: 1,
  org: ORG,
  token: CONTRACT_ID,
  title: "Indexed campaign",
  description_uri: "https://example.org/campaign",
  goal: 100n,
  deadline: 2_000_000_000n,
  total_raised: 100n,
  total_released: 100n,
  total_withdrawn: 0n,
  held: 0n,
  total_shares: 0n,
  epoch: 1,
  window_secs: 60n,
  bond_amount: 10n,
  bond_state: { tag: "Returned" },
  status: { tag: "Completed" },
  milestones: [
    {
      description: "First milestone",
      amount: 100n,
      status: { tag: "Released" },
      evidence_hash: evidence,
      evidence_uri: "https://example.org/evidence",
      window_end: 200n,
      released_amount: 100n,
    },
  ],
};

const databases: IndexerDatabase[] = [];

function makeDatabase(): IndexerDatabase {
  const database = new IndexerDatabase(":memory:");
  databases.push(database);
  return database;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
});

function valueScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, value]) =>
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol(key),
          val: value,
        }),
    ),
  );
}

function event(
  id: string,
  ledger: number,
  type: string,
  topicValues: xdr.ScVal[],
  fields: Record<string, xdr.ScVal> = {},
  transactionIndex = 0,
  value?: xdr.ScVal,
): RpcEvent {
  return {
    id,
    type: "contract",
    ledger,
    ledgerClosedAt: new Date(ledger * 1000).toISOString(),
    transactionIndex,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: id.padStart(64, "0").slice(-64),
    contractId: CONTRACT_ID,
    topic: [xdr.ScVal.scvSymbol(type), ...topicValues],
    value: value ?? valueScVal(fields),
  };
}

const u32 = (value: number) => xdr.ScVal.scvU32(value);
const i128 = (value: bigint) => nativeToScVal(value, { type: "i128" });
const scString = (value: string) => xdr.ScVal.scvString(value);

function campaignEvents(): RpcEvent[] {
  return [
    event("00100-0000000000", 100, "campaign_created", [u32(1)], {
      org: nativeToScVal(ORG, { type: "address" }),
      token: nativeToScVal(CONTRACT_ID, { type: "address" }),
      goal: i128(100n),
      deadline: nativeToScVal(2_000_000_000n, { type: "u64" }),
    }),
    event(
      "00101-0000000000",
      101,
      "donated",
      [u32(1), nativeToScVal(DONOR, { type: "address" })],
      { amount: i128(100n), shares: i128(100n) },
    ),
    event("00102-0000000000", 102, "evidence_submitted", [u32(1), u32(0)], {
      org: nativeToScVal(ORG, { type: "address" }),
      evidence_hash: nativeToScVal(evidence, { type: "bytes" }),
      evidence_uri: scString("https://example.org/evidence"),
      window_end: nativeToScVal(200n, { type: "u64" }),
    }),
    event(
      "00103-0000000000",
      103,
      "milestone_released",
      [u32(1), u32(0)],
      {
        org: nativeToScVal(ORG, { type: "address" }),
        amount: i128(100n),
      },
      0,
    ),
    event(
      "00103-0000000001",
      103,
      "campaign_completed",
      [u32(1)],
      { total_released: i128(100n) },
      0,
    ),
    event("00103-0000000002", 103, "bond_returned", [u32(1)], {
      org: nativeToScVal(ORG, { type: "address" }),
      amount: i128(10n),
    }),
    event(
      "00104-0000000000",
      104,
      "exited",
      [u32(1), nativeToScVal(DONOR, { type: "address" })],
      { amount: i128(100n), shares: i128(100n) },
    ),
    event("00105-0000000000", 105, "bond_slashed", [u32(1)], {
      amount: i128(10n),
    }),
    event("00106-0000000000", 106, "campaign_cancelled", [u32(1)], {
      org: nativeToScVal(ORG, { type: "address" }),
    }),
  ];
}

function eventResponse(events: RpcEvent[], ledger: number) {
  return {
    events,
    cursor: events.at(-1)?.id ?? `cursor-${ledger}`,
    latestLedger: ledger,
    oldestLedger: 90,
  };
}

function makeRpc(events: RpcEvent[]): IndexerRpcClient {
  return {
    getLatestLedger: vi.fn(async () => ({ sequence: 110 })),
    getEvents: vi.fn(async (request) =>
      eventResponse(
        "startLedger" in request && request.startLedger === 110 ? [] : events,
        110,
      ),
    ),
    queryContract: vi.fn(async <T>() => ({
      result: { value: campaignSnapshot } as T,
      isReadCall: true,
    })),
  };
}

function makeIndexer(
  database: IndexerDatabase,
  rpcServer: IndexerRpcClient,
): SorobanEventIndexer {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return new SorobanEventIndexer({
    rpcServer,
    database,
    contractId: CONTRACT_ID,
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
    startLedger: 100,
    pageSize: 100,
    logger,
  });
}

describe("SorobanEventIndexer", () => {
  it("sorts events chronologically and builds campaign, donation, and release projections", async () => {
    const database = makeDatabase();
    const indexer = makeIndexer(database, makeRpc(campaignEvents().reverse()));

    const indexedCount = await indexer.pollOnce();

    expect(indexedCount).toBe(9);
    expect(database.getLastLedger()).toBe(110);
    expect(
      database.connection
        .prepare("SELECT type FROM events ORDER BY rowid")
        .all(),
    ).toEqual([
      { type: "campaign_created" },
      { type: "donated" },
      { type: "evidence_submitted" },
      { type: "milestone_released" },
      { type: "campaign_completed" },
      { type: "bond_returned" },
      { type: "exited" },
      { type: "bond_slashed" },
      { type: "campaign_cancelled" },
    ]);
    expect(
      database.connection
        .prepare(
          "SELECT title, status, total_raised, total_released FROM campaigns WHERE id = 1",
        )
        .get(),
    ).toEqual({
      title: "Indexed campaign",
      status: "Completed",
      total_raised: "100",
      total_released: "100",
    });
    expect(
      database.connection
        .prepare(
          "SELECT amount, shares, withdrawn FROM donations WHERE campaign_id = 1 AND donor = ?",
        )
        .get(DONOR),
    ).toEqual({ amount: "100", shares: "0", withdrawn: "100" });
    expect(
      database.connection
        .prepare(
          "SELECT status, evidence_hash, released_amount FROM milestones WHERE campaign_id = 1 AND milestone_index = 0",
        )
        .get(),
    ).toEqual({
      status: "Released",
      evidence_hash: evidence.toString("hex"),
      released_amount: "100",
    });
    const indexedEvent = database.connection
      .prepare(
        "SELECT tx_hash, explorer_url, type FROM events WHERE type = 'donated'",
      )
      .get() as { tx_hash: string; explorer_url: string; type: string };
    expect(indexedEvent.type).toBe("donated");
    expect(indexedEvent.explorer_url).toBe(
      `https://stellar.expert/explorer/testnet/tx/${indexedEvent.tx_hash}`,
    );
  });

  it("does not duplicate records or donation amounts when a processed range is replayed", async () => {
    const database = makeDatabase();
    const indexer = makeIndexer(database, makeRpc(campaignEvents()));

    await indexer.pollOnce();
    database.setLastLedger(109);
    await indexer.pollOnce();

    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({ count: 9 });
    expect(
      database.connection
        .prepare(
          "SELECT amount FROM donations WHERE campaign_id = 1 AND donor = ?",
        )
        .get(DONOR),
    ).toEqual({ amount: "100" });
  });

  it("recovers after a crash before checkpointing and replays already-written events safely", async () => {
    const database = makeDatabase();
    const rpcServer = makeRpc(campaignEvents());
    let getterCalls = 0;
    rpcServer.queryContract = vi.fn(async <T>() => {
      getterCalls += 1;
      if (getterCalls === 2) throw new Error("simulated interruption");
      return { result: { value: campaignSnapshot } as T, isReadCall: true };
    });
    const indexer = makeIndexer(database, rpcServer);

    await expect(indexer.pollOnce()).rejects.toThrow("simulated interruption");
    expect(database.getLastLedger()).toBe(0);
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({ count: 9 });

    await indexer.pollOnce();

    expect(database.getLastLedger()).toBe(110);
    expect(
      database.connection
        .prepare(
          "SELECT amount FROM donations WHERE campaign_id = 1 AND donor = ?",
        )
        .get(DONOR),
    ).toEqual({ amount: "100" });
    expect(
      database.connection.prepare("SELECT COUNT(*) AS count FROM events").get(),
    ).toEqual({ count: 9 });
  });

  it("stores contract events with no non-indexed value", async () => {
    const database = makeDatabase();
    const noPayloadEvent = event(
      "00105-0000000000",
      105,
      "campaign_cancelled",
      [u32(1)],
      { org: nativeToScVal(ORG, { type: "address" }) },
      0,
      xdr.ScVal.scvVoid(),
    );
    const indexer = makeIndexer(database, makeRpc([noPayloadEvent]));

    await indexer.pollOnce();

    expect(
      database.connection
        .prepare("SELECT type, payload_json FROM events")
        .get(),
    ).toEqual({
      type: "campaign_cancelled",
      payload_json: JSON.stringify({
        topics: ["campaign_cancelled", 1],
        value: {},
      }),
    });
  });
});
