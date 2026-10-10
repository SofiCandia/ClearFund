import { scValToNative, type xdr } from "@stellar/stellar-sdk";
import { rpc } from "@stellar/stellar-sdk";
import type {
  CampaignSnapshot,
  EventProjection,
  IndexerDatabase,
  StoredEvent,
} from "./database.js";

export type RpcEvent = Awaited<
  ReturnType<rpc.Server["getEvents"]>
>["events"][number];

export interface IndexerRpcClient {
  getLatestLedger(): Promise<{ sequence: number }>;
  getEvents(
    request: Parameters<rpc.Server["getEvents"]>[0],
  ): Promise<
    Pick<
      Awaited<ReturnType<rpc.Server["getEvents"]>>,
      "events" | "cursor" | "latestLedger" | "oldestLedger"
    >
  >;
  queryContract<T = unknown>(
    contractId: string,
    method: string,
    args?: Record<string, unknown>,
    networkPassphrase?: string,
  ): Promise<{ result: T; isReadCall: boolean }>;
}

export interface IndexerLogger {
  info: (data: object, message?: string) => void;
  warn: (data: object, message?: string) => void;
  error: (data: object, message?: string) => void;
}

export interface IndexerOptions {
  rpcServer: IndexerRpcClient;
  database: IndexerDatabase;
  contractId: string;
  networkPassphrase: string;
  network: string;
  pollIntervalMs?: number;
  startLedger?: number;
  pageSize?: number;
  ledgerBatchSize?: number;
  logger: IndexerLogger;
}

interface DecodedEvent {
  type: string;
  campaignId?: number;
  projection: EventProjection;
  payload: string;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_LEDGER_BATCH_SIZE = 1000;
const MAX_BACKOFF_MS = 60_000;

function toRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value as Record<string, unknown>;
}

function toInteger(value: unknown, label: string): number {
  const parsed =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label} in Soroban event: ${String(value)}.`);
  }
  return parsed;
}

function toBigIntString(value: unknown, label: string): string {
  try {
    return BigInt(value as string | number | bigint).toString();
  } catch (error) {
    throw new Error(`Invalid ${label} in Soroban event.`, { cause: error });
  }
}

function toStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${label} in Soroban event.`);
  }
  return value;
}

function statusValue(value: unknown, label: string): string {
  if (typeof value === "string") return value;
  const status = toRecord(value, label).tag;
  return toStringValue(status, label);
}

function evidenceHash(value: unknown): string {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (typeof value === "string") return value;
  throw new Error("Invalid evidence_hash in Soroban event.");
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries(), ([key, entry]) => [
        String(key),
        jsonSafe(entry),
      ]),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonSafe(entry)]),
    );
  }
  return value;
}

function fromScVal(value: xdr.ScVal): unknown {
  return scValToNative(value);
}

function eventOrder(left: RpcEvent, right: RpcEvent): number {
  return (
    left.ledger - right.ledger ||
    left.transactionIndex - right.transactionIndex ||
    left.operationIndex - right.operationIndex ||
    left.id.localeCompare(right.id)
  );
}

function decodeEvent(event: RpcEvent): DecodedEvent {
  const topics = event.topic.map(fromScVal);
  const type = toStringValue(topics[0], "event type");
  const nativeValue = fromScVal(event.value);
  const value =
    nativeValue === undefined ||
    nativeValue === null ||
    (Array.isArray(nativeValue) && nativeValue.length === 0)
      ? {}
      : toRecord(nativeValue, "event value");
  const campaignId =
    topics.length > 1 ? toInteger(topics[1], "campaign_id") : undefined;
  let projection: EventProjection = { type: "unknown" };

  switch (type) {
    case "campaign_created":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = { type, campaignId };
      break;
    case "donated":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = {
        type,
        campaignId,
        donor: toStringValue(topics[2], "donor"),
        amount: toBigIntString(value.amount, "amount"),
        shares: toBigIntString(value.shares, "shares"),
      };
      break;
    case "evidence_submitted":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = {
        type,
        campaignId,
        milestoneIndex: toInteger(topics[2], "milestone_index"),
        evidenceHash: evidenceHash(value.evidence_hash),
        evidenceUri: toStringValue(value.evidence_uri, "evidence_uri"),
        windowEnd: toInteger(value.window_end, "window_end"),
      };
      break;
    case "exited":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = {
        type,
        campaignId,
        donor: toStringValue(topics[2], "donor"),
        amount: toBigIntString(value.amount, "amount"),
        shares: toBigIntString(value.shares, "shares"),
      };
      break;
    case "milestone_released":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = {
        type,
        campaignId,
        milestoneIndex: toInteger(topics[2], "milestone_index"),
        amount: toBigIntString(value.amount, "amount"),
      };
      break;
    case "campaign_completed":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = {
        type,
        campaignId,
        totalReleased: toBigIntString(value.total_released, "total_released"),
      };
      break;
    case "bond_returned":
    case "bond_slashed":
    case "campaign_cancelled":
      if (campaignId === undefined) throw new Error("campaign_id is missing.");
      projection = { type, campaignId };
      break;
  }

  return {
    type,
    ...(campaignId === undefined ? {} : { campaignId }),
    projection,
    payload: JSON.stringify(jsonSafe({ topics, value })),
  };
}

function nativeCampaignToSnapshot(value: unknown): CampaignSnapshot {
  const campaign = toRecord(value, "campaign getter result");
  const milestones = campaign.milestones;
  if (!Array.isArray(milestones)) {
    throw new Error("The get_campaign getter returned an invalid campaign.");
  }
  return {
    id: toInteger(campaign.id, "campaign id"),
    org: toStringValue(campaign.org, "campaign org"),
    token: toStringValue(campaign.token, "campaign token"),
    title: toStringValue(campaign.title, "campaign title"),
    description_uri: toStringValue(
      campaign.description_uri,
      "campaign description_uri",
    ),
    goal: toBigIntString(campaign.goal, "campaign goal"),
    deadline: toInteger(campaign.deadline, "campaign deadline"),
    window_secs: toInteger(campaign.window_secs, "campaign window_secs"),
    bond_amount: toBigIntString(campaign.bond_amount, "bond_amount"),
    bond_state: statusValue(campaign.bond_state, "bond_state"),
    total_raised: toBigIntString(campaign.total_raised, "total_raised"),
    total_released: toBigIntString(campaign.total_released, "total_released"),
    total_withdrawn: toBigIntString(
      campaign.total_withdrawn,
      "total_withdrawn",
    ),
    held: toBigIntString(campaign.held, "held"),
    total_shares: toBigIntString(campaign.total_shares, "total_shares"),
    epoch: toInteger(campaign.epoch, "campaign epoch"),
    status: statusValue(campaign.status, "campaign status"),
    milestones: milestones.map((entry) => {
      const milestone = toRecord(entry, "milestone getter result");
      return {
        description: toStringValue(
          milestone.description,
          "milestone description",
        ),
        amount: toBigIntString(milestone.amount, "milestone amount"),
        status: statusValue(milestone.status, "milestone status"),
        evidence_hash: evidenceHash(milestone.evidence_hash),
        evidence_uri:
          typeof milestone.evidence_uri === "string"
            ? milestone.evidence_uri
            : "",
        window_end: toInteger(milestone.window_end, "milestone window_end"),
        released_amount: toBigIntString(
          milestone.released_amount,
          "milestone released_amount",
        ),
      };
    }),
  };
}

function snapshotFromGetterResult(result: unknown): CampaignSnapshot {
  const response = toRecord(result, "get_campaign response");
  const rustResult = toRecord(response.result, "get_campaign result");
  if (!("value" in rustResult)) {
    throw new Error(
      `get_campaign returned a Soroban contract error: ${JSON.stringify(jsonSafe(rustResult))}`,
    );
  }
  return nativeCampaignToSnapshot(rustResult.value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export class SorobanEventIndexer {
  private readonly pollIntervalMs: number;
  private readonly startLedger: number;
  private readonly pageSize: number;
  private readonly ledgerBatchSize: number;
  private stopped = false;
  private runPromise: Promise<void> | undefined;

  constructor(private readonly options: IndexerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.startLedger = options.startLedger ?? 0;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.ledgerBatchSize = options.ledgerBatchSize ?? DEFAULT_LEDGER_BATCH_SIZE;
    if (
      this.pollIntervalMs < 100 ||
      this.pageSize < 1 ||
      this.ledgerBatchSize < 1
    ) {
      throw new Error(
        "Indexer polling and pagination settings must be positive.",
      );
    }
  }

  start(): void {
    if (this.runPromise) return;
    this.stopped = false;
    this.runPromise = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.runPromise;
    this.runPromise = undefined;
  }

  async pollOnce(): Promise<number> {
    const latest = await this.options.rpcServer.getLatestLedger();
    const metadata = await this.options.rpcServer.getEvents({
      startLedger: latest.sequence,
      filters: [
        {
          type: "contract",
          contractIds: [this.options.contractId],
        },
      ],
      limit: 1,
    });
    const lastLedger = this.options.database.getLastLedger();
    let nextLedger =
      lastLedger === 0
        ? Math.max(this.startLedger, metadata.oldestLedger)
        : lastLedger + 1;

    if (lastLedger > 0 && nextLedger < metadata.oldestLedger) {
      throw new Error(
        `Indexer cursor ${nextLedger} is older than Soroban RPC retention ledger ${metadata.oldestLedger}; restore an archive-capable RPC or reset the indexer explicitly.`,
      );
    }
    if (nextLedger > latest.sequence) return 0;
    if (
      lastLedger === 0 &&
      this.startLedger > 0 &&
      this.startLedger < metadata.oldestLedger
    ) {
      this.options.logger.warn(
        {
          configuredStartLedger: this.startLedger,
          oldestLedger: metadata.oldestLedger,
        },
        "Configured indexer start ledger is outside RPC retention; starting at the oldest available ledger.",
      );
      nextLedger = metadata.oldestLedger;
    }

    let indexedCount = 0;
    while (nextLedger <= metadata.latestLedger && !this.stopped) {
      const endLedger = Math.min(
        nextLedger + this.ledgerBatchSize - 1,
        metadata.latestLedger,
      );
      const events = await this.fetchRange(nextLedger, endLedger);
      events.sort(eventOrder);
      const campaignIds = new Set<number>();
      for (const event of events) {
        const decoded = decodeEvent(event);
        let campaign: CampaignSnapshot | undefined;
        if (decoded.campaignId !== undefined) {
          campaignIds.add(decoded.campaignId);
        }
        if (
          decoded.campaignId !== undefined &&
          !this.options.database.hasCampaign(decoded.campaignId)
        ) {
          campaign = await this.fetchCampaign(decoded.campaignId);
        }
        const stored: StoredEvent = {
          id: event.id,
          txHash: event.txHash,
          ledger: event.ledger,
          timestamp: event.ledgerClosedAt,
          type: decoded.type,
          payload: decoded.payload,
          explorerUrl: `https://stellar.expert/explorer/${this.options.network}/tx/${event.txHash}`,
        };
        if (
          this.options.database.recordEvent(
            stored,
            decoded.projection,
            campaign,
          )
        ) {
          indexedCount += 1;
        }
      }
      for (const campaignId of campaignIds) {
        const campaign = await this.fetchCampaign(campaignId);
        this.options.database.syncCampaignSnapshot(campaign, endLedger);
      }
      this.options.database.setLastLedger(endLedger);
      this.options.logger.info(
        { lastLedger: endLedger, eventsIndexed: events.length },
        "Soroban event indexer advanced its ledger checkpoint.",
      );
      nextLedger = endLedger + 1;
    }
    return indexedCount;
  }

  private async fetchRange(
    startLedger: number,
    endLedger: number,
  ): Promise<RpcEvent[]> {
    const filters = [
      {
        type: "contract" as const,
        contractIds: [this.options.contractId],
      },
    ];
    const result: RpcEvent[] = [];
    let response = await this.options.rpcServer.getEvents({
      startLedger,
      endLedger,
      filters,
      limit: this.pageSize,
    });
    let cursor: string | undefined;

    while (true) {
      const inRange = response.events.filter(
        (event) => event.ledger <= endLedger,
      );
      result.push(...inRange);
      if (
        response.events.some((event) => event.ledger > endLedger) ||
        response.events.length < this.pageSize
      ) {
        break;
      }
      if (cursor === response.cursor) {
        throw new Error(
          "Soroban RPC event pagination did not advance its cursor.",
        );
      }
      cursor = response.cursor;
      response = await this.options.rpcServer.getEvents({
        cursor,
        filters,
        limit: this.pageSize,
      });
    }
    return result;
  }

  private async fetchCampaign(campaignId: number): Promise<CampaignSnapshot> {
    const result = await this.options.rpcServer.queryContract<unknown>(
      this.options.contractId,
      "get_campaign",
      { campaign_id: campaignId },
      this.options.networkPassphrase,
    );
    return snapshotFromGetterResult(result);
  }

  private async run(): Promise<void> {
    let consecutiveFailures = 0;
    while (!this.stopped) {
      try {
        const indexedCount = await this.pollOnce();
        consecutiveFailures = 0;
        if (indexedCount > 0) {
          this.options.logger.info(
            { eventsIndexed: indexedCount },
            "Soroban event polling pass completed.",
          );
        }
        await delay(this.pollIntervalMs);
      } catch (error) {
        consecutiveFailures += 1;
        const backoffMs = Math.min(
          this.pollIntervalMs * 2 ** Math.min(consecutiveFailures - 1, 10),
          MAX_BACKOFF_MS,
        );
        this.options.logger.error(
          { err: error, retryInMs: backoffMs, consecutiveFailures },
          "Soroban event indexing failed; retrying with backoff.",
        );
        await delay(backoffMs);
      }
    }
  }
}
