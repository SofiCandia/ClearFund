import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Address, StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";
import type { IndexerDatabase } from "../indexer/database.js";
import type { StorageProvider } from "../storage/storage-provider.js";
import {
  TransactionInputError,
  TransactionPendingError,
  type TransactionService,
} from "../transactions/transaction-service.js";

const positiveIdSchema = z.coerce.number().int().positive().max(4_294_967_295);
const pageSchema = z.coerce.number().int().positive().default(1);
const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
const addressSchema = z.string().refine(StrKey.isValidEd25519PublicKey, {
  message: "Address must be a valid Stellar public key.",
});
const maxI128 = (1n << 127n) - 1n;
const maxU64 = (1n << 64n) - 1n;
const positiveI128Schema = z
  .string()
  .regex(/^[1-9]\d{0,37}$/)
  .refine(
    (value) => !/^[1-9]\d{0,37}$/.test(value) || BigInt(value) <= maxI128,
    {
      message: "Amount exceeds the maximum signed i128 value.",
    },
  );
const contractAddressSchema = z.string().superRefine((value, context) => {
  try {
    if (Address.fromString(value).type !== "contract") {
      context.addIssue({
        code: "custom",
        message: "Token must be a Soroban token contract address.",
      });
    }
  } catch {
    context.addIssue({
      code: "custom",
      message: "Address must be a valid Stellar account or contract address.",
    });
  }
});
const campaignParamsSchema = z.object({ id: positiveIdSchema });
const evidenceParamsSchema = z.object({
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
const campaignsQuerySchema = z.object({
  status: z.enum(["Active", "Completed", "Expired", "Cancelled"]).optional(),
  page: pageSchema,
  limit: limitSchema,
  search: z.string().trim().max(200).optional(),
});
const donationsQuerySchema = z.object({
  page: pageSchema,
  limit: limitSchema,
});
const campaignsQueryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["Active", "Completed", "Expired", "Cancelled"],
    },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    search: { type: "string", maxLength: 200 },
  },
};
const donationsQueryJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
};
const donorParamsSchema = z.object({ address: addressSchema });
const createCampaignSchema = z
  .object({
    source: addressSchema,
    org: addressSchema,
    token: contractAddressSchema,
    title: z.string().trim().min(1).max(120),
    description_uri: z.string().url().max(2048),
    milestones: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          amount: positiveI128Schema,
        }),
      )
      .min(1)
      .max(32),
    window_seconds: z.coerce
      .number()
      .int()
      .min(60)
      .max(2_592_000)
      .default(259_200),
    deadline: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .refine(
        (value) => !/^[1-9]\d{0,19}$/.test(value) || BigInt(value) <= maxU64,
        {
          message: "Deadline exceeds the maximum u64 value.",
        },
      )
      .refine(
        (value) =>
          !/^[1-9]\d{0,19}$/.test(value) ||
          BigInt(value) > BigInt(Math.floor(Date.now() / 1000)),
        {
          message: "Deadline must be in the future.",
        },
      ),
  })
  .superRefine((input, context) => {
    if (input.source !== input.org) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "source must match the organization wallet.",
      });
    }
    if (
      BigInt(input.deadline) >
      BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400)
    ) {
      context.addIssue({
        code: "custom",
        path: ["deadline"],
        message: "deadline cannot be more than 365 days in the future.",
      });
    }
    const goal = input.milestones.reduce(
      (sum, milestone) => sum + BigInt(milestone.amount),
      0n,
    );
    if (goal > maxI128) {
      context.addIssue({
        code: "custom",
        path: ["milestones"],
        message:
          "Total milestone amount exceeds the maximum signed i128 value.",
      });
    }
  });
const donateSchema = z
  .object({
    source: addressSchema,
    donor: addressSchema,
    campaign_id: positiveIdSchema,
    amount: positiveI128Schema,
  })
  .refine((input) => input.source === input.donor, {
    path: ["source"],
    message: "source must match the donor wallet.",
  });
const submitEvidenceSchema = z.object({
  campaign_id: positiveIdSchema,
  milestone_index: z.number().int().nonnegative().max(31),
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
  evidence_uri: z.string().url().max(2048),
});
const withdrawSchema = z
  .object({
    source: addressSchema,
    donor: addressSchema,
    campaign_id: positiveIdSchema,
  })
  .refine((input) => input.source === input.donor, {
    path: ["source"],
    message: "source must match the donor wallet.",
  });
const releaseMilestoneSchema = z.object({
  source: addressSchema,
  campaign_id: positiveIdSchema,
  milestone_index: z.number().int().nonnegative().max(31),
});
const reclaimBondSchema = z.object({ campaign_id: positiveIdSchema });
const submitTransactionSchema = z.object({
  xdr: z.string().min(1).max(100_000),
});

interface CampaignRow {
  id: number;
  org: string;
  token: string;
  title: string;
  description_uri: string;
  goal: string;
  deadline: number;
  window_secs: number;
  bond_amount: string;
  bond_state: string;
  total_raised: string;
  total_released: string;
  total_withdrawn: string;
  held: string;
  total_shares: string;
  epoch: number;
  status: string;
  updated_ledger: number;
}

interface MilestoneRow {
  campaign_id: number;
  milestone_index: number;
  description: string;
  amount: string;
  status: string;
  evidence_hash: string;
  evidence_uri: string;
  window_end: number;
  released_amount: string;
  updated_ledger: number;
}

interface DonationRow {
  campaign_id: number;
  donor: string;
  amount: string;
  shares: string;
  withdrawn: string;
  position_epoch: number;
  updated_ledger: number;
}

interface ApiDependencies {
  database: IndexerDatabase;
  contractId: string;
  network: string;
  rpcServer: {
    queryContract<T = unknown>(
      contractId: string,
      method: string,
      args?: Record<string, unknown>,
      networkPassphrase?: string,
    ): Promise<{ result: T; isReadCall: boolean }>;
  };
  networkPassphrase: string;
  transactionService: Pick<
    TransactionService,
    | "createCampaign"
    | "donate"
    | "submitEvidence"
    | "withdraw"
    | "releaseMilestone"
    | "reclaimBond"
    | "submitSignedXdr"
  >;
  storageProvider: StorageProvider;
}

interface OnChainCampaign {
  id: number;
  org: string;
  token: string;
  goal: string | bigint;
  total_raised: string | bigint;
  total_released: string | bigint;
  total_withdrawn: string | bigint;
  held: string | bigint;
}

interface ErrorResponse {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function amount(value: string | bigint | number): bigint {
  return BigInt(value);
}

function asErrorResponse(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

function validateBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
    );
  }
  return result.data;
}

function validateParams<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "INVALID_REQUEST", "Invalid route parameters.");
  }
  return result.data;
}

function validateQuery<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "INVALID_REQUEST", "Invalid query parameters.");
  }
  return result.data;
}

function campaignOrNotFound(
  dependencies: ApiDependencies,
  campaignId: number,
): CampaignRow {
  const campaign = dependencies.database.connection
    .prepare("SELECT * FROM campaigns WHERE id = ?")
    .get(campaignId) as CampaignRow | undefined;
  if (!campaign) {
    throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign was not found.");
  }
  return campaign;
}

function campaignMilestones(
  dependencies: ApiDependencies,
  campaignId: number,
): MilestoneRow[] {
  return dependencies.database.connection
    .prepare(
      "SELECT * FROM milestones WHERE campaign_id = ? ORDER BY milestone_index",
    )
    .all(campaignId) as MilestoneRow[];
}

function campaignProgress(campaign: CampaignRow) {
  const goal = amount(campaign.goal);
  const funded = amount(campaign.held) + amount(campaign.total_released);
  return {
    funded: funded.toString(),
    progress_percent: goal === 0n ? 0 : Number((funded * 10_000n) / goal) / 100,
    max_donation: (goal > funded ? goal - funded : 0n).toString(),
  };
}

async function positionFor(
  dependencies: ApiDependencies,
  campaign: CampaignRow,
  donor: string,
  positionEpoch: number,
  shares: string,
  withdrawn: string,
): Promise<{ shares: string; value: string; withdrawn: string }> {
  let currentShares = shares;
  let currentWithdrawn = withdrawn;
  if (positionEpoch !== campaign.epoch) {
    const response = await dependencies.rpcServer.queryContract<unknown>(
      requireContractId(dependencies.contractId),
      "get_position",
      { campaign_id: campaign.id, donor },
      dependencies.networkPassphrase,
    );
    const view = unwrapRpcValue<Record<string, unknown>>(
      response.result,
      "position",
    );
    currentShares = toBigInt(view.shares, "position shares").toString();
    currentWithdrawn = toBigInt(
      view.withdrawn,
      "position withdrawn",
    ).toString();
  }
  const value =
    BigInt(campaign.total_shares) === 0n
      ? 0n
      : (BigInt(currentShares) * BigInt(campaign.held)) /
        BigInt(campaign.total_shares);
  return {
    shares: currentShares,
    value: value.toString(),
    withdrawn: currentWithdrawn,
  };
}

function isWithdrawable(
  campaign: CampaignRow,
  milestones: MilestoneRow[],
  now: number,
): boolean {
  const windowOpen = milestones.some(
    (milestone) =>
      milestone.status === "EvidenceSubmitted" && now < milestone.window_end,
  );
  if (windowOpen) return true;
  const releasePending = milestones.some(
    (milestone) =>
      milestone.status === "EvidenceSubmitted" && now >= milestone.window_end,
  );
  return (
    now > campaign.deadline &&
    campaign.status !== "Completed" &&
    !releasePending
  );
}

function toBigInt(value: unknown, label: string): bigint {
  try {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "bigint"
    ) {
      throw new TypeError();
    }
    return BigInt(value);
  } catch (error) {
    throw new Error(`Soroban RPC returned an invalid ${label} value.`, {
      cause: error,
    });
  }
}

function serializeCampaign(campaign: CampaignRow) {
  return {
    id: campaign.id,
    org: campaign.org,
    token: campaign.token,
    title: campaign.title,
    description_uri: campaign.description_uri,
    goal: campaign.goal,
    deadline: campaign.deadline,
    window_secs: campaign.window_secs,
    bond_amount: campaign.bond_amount,
    bond_state: campaign.bond_state,
    total_raised: campaign.total_raised,
    total_released: campaign.total_released,
    total_withdrawn: campaign.total_withdrawn,
    held: campaign.held,
    status: campaign.status,
    ...campaignProgress(campaign),
  };
}

function pageResult<T>(data: T[], page: number, limit: number, total: number) {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

function unwrapRpcValue<T>(result: unknown, label: string): T {
  if (typeof result === "object" && result !== null && "value" in result) {
    return result.value as T;
  }
  if (typeof result === "bigint" || typeof result === "string") {
    return result as T;
  }
  throw new Error(`Soroban RPC returned an invalid ${label} value.`);
}

async function getOnChainCampaign(
  dependencies: ApiDependencies,
  contractId: string,
  campaignId: number,
): Promise<OnChainCampaign> {
  const response = await dependencies.rpcServer.queryContract<unknown>(
    contractId,
    "get_campaign",
    { campaign_id: campaignId },
    dependencies.networkPassphrase,
  );
  const root = response.result;
  if (
    typeof root !== "object" ||
    root === null ||
    !("value" in root) ||
    typeof root.value !== "object" ||
    root.value === null
  ) {
    throw new Error("The campaign getter returned an invalid result.");
  }
  const value = root.value as OnChainCampaign;
  if (
    value.id !== campaignId ||
    typeof value.org !== "string" ||
    typeof value.token !== "string"
  ) {
    throw new Error("The campaign getter returned an invalid campaign.");
  }
  return value;
}

function requireContractId(contractId: string): string {
  if (!contractId) {
    throw new ApiError(
      503,
      "CONTRACT_NOT_CONFIGURED",
      "The Soroban contract is not configured.",
    );
  }
  return contractId;
}

function registerOpenApiSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: "draft-7",
    unrepresentable: "any",
  });
}

function assertUploadType(
  file: Buffer,
  contentType: string,
): "application/pdf" | "image/png" | "image/jpeg" {
  if (
    contentType === "application/pdf" &&
    file.subarray(0, 5).toString("ascii") === "%PDF-"
  ) {
    return "application/pdf";
  }
  if (
    contentType === "image/png" &&
    file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (
    contentType === "image/jpeg" &&
    file.length >= 3 &&
    file[0] === 0xff &&
    file[1] === 0xd8 &&
    file[2] === 0xff
  ) {
    return "image/jpeg";
  }
  throw new ApiError(
    415,
    "UNSUPPORTED_FILE_TYPE",
    "Only PDF, PNG, and JPEG files with matching file contents are accepted.",
  );
}

async function readEvidence(
  storageProvider: StorageProvider,
  hash: string,
): Promise<Buffer> {
  try {
    return await storageProvider.read(hash);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new ApiError(
        404,
        "EVIDENCE_NOT_FOUND",
        "Evidence file was not found.",
      );
    }
    throw error;
  }
}

export function registerApiRoutes(
  app: FastifyInstance,
  dependencies: ApiDependencies,
): void {
  const stringIntegerSchema = {
    type: "string",
    pattern: "^-?\\d+$",
    description:
      "Integer amount in token base units; decimal string avoids precision loss.",
  };
  const campaignSchema = {
    type: "object",
    required: [
      "id",
      "org",
      "token",
      "title",
      "description_uri",
      "goal",
      "deadline",
      "window_secs",
      "bond_amount",
      "bond_state",
      "total_raised",
      "total_released",
      "total_withdrawn",
      "held",
      "status",
      "progress_percent",
      "funded",
      "max_donation",
    ],
    properties: {
      id: { type: "integer", minimum: 1 },
      org: { type: "string", description: "Organization Stellar address." },
      token: { type: "string", description: "Soroban token contract address." },
      title: { type: "string" },
      description_uri: { type: "string", format: "uri" },
      goal: stringIntegerSchema,
      deadline: { type: "integer", description: "Unix timestamp in seconds." },
      window_secs: { type: "integer", minimum: 60, maximum: 2_592_000 },
      bond_amount: stringIntegerSchema,
      bond_state: { type: "string", enum: ["Held", "Returned", "Slashed"] },
      total_raised: stringIntegerSchema,
      total_released: stringIntegerSchema,
      total_withdrawn: stringIntegerSchema,
      held: stringIntegerSchema,
      status: {
        type: "string",
        enum: ["Active", "Completed", "Expired", "Cancelled"],
      },
      progress_percent: { type: "number", minimum: 0 },
      funded: stringIntegerSchema,
      max_donation: stringIntegerSchema,
    },
  };
  const pageResponseSchema = (items: Record<string, unknown>) => ({
    type: "object",
    required: ["data", "pagination"],
    properties: {
      data: { type: "array", items },
      pagination: {
        type: "object",
        required: ["page", "limit", "total", "pages"],
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          pages: { type: "integer" },
        },
      },
    },
  });
  const donationSchema = {
    type: "object",
    required: [
      "campaign_id",
      "donor",
      "amount",
      "shares",
      "current_value",
      "withdrawn",
      "withdrawable",
      "updated_ledger",
    ],
    properties: {
      campaign_id: { type: "integer" },
      donor: { type: "string" },
      amount: stringIntegerSchema,
      shares: stringIntegerSchema,
      current_value: stringIntegerSchema,
      withdrawn: stringIntegerSchema,
      withdrawable: { type: "boolean" },
      updated_ledger: { type: "integer" },
      title: { type: "string" },
      status: { type: "string" },
    },
  };
  const eventSchema = {
    type: "object",
    required: [
      "event_id",
      "tx_hash",
      "ledger",
      "timestamp",
      "type",
      "payload",
      "explorer_url",
    ],
    properties: {
      event_id: { type: "string" },
      tx_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
      ledger: { type: "integer" },
      timestamp: { type: "string", format: "date-time" },
      type: { type: "string" },
      payload: {},
      explorer_url: { type: "string", format: "uri" },
    },
  };
  const errorSchema = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  };
  const txResponseSchema = {
    type: "object",
    required: ["xdr", "signed"],
    properties: {
      xdr: {
        type: "string",
        description: "Base64 unsigned transaction envelope XDR.",
      },
      signed: { type: "boolean", const: false },
    },
  };
  const responseErrorCodes = [400, 404, 413, 415, 429, 500] as const;
  const withErrors = (responses: Record<number, unknown>) => {
    const result = { ...responses };
    for (const status of responseErrorCodes) {
      if (!(status in result)) {
        result[status] = {
          ...errorSchema,
          description: "Standardized API error response.",
        };
      }
    }
    return result;
  };

  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Health check",
        response: withErrors({
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", const: "ok" } },
          },
        }),
      },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/campaigns",
    {
      schema: {
        tags: ["Campaigns"],
        summary: "List campaigns with status, search, and pagination filters",
        querystring: campaignsQueryJsonSchema,
        response: withErrors({
          200: pageResponseSchema(campaignSchema),
        }),
      },
    },
    async (request) => {
      const query = validateQuery(campaignsQuerySchema, request.query);
      const conditions: string[] = [];
      const parameters: (string | number)[] = [];
      if (query.status) {
        conditions.push("status = ?");
        parameters.push(query.status);
      }
      if (query.search) {
        conditions.push(
          "(LOWER(title) LIKE ? OR LOWER(description_uri) LIKE ?)",
        );
        const search = `%${query.search.toLocaleLowerCase()}%`;
        parameters.push(search, search);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const totalRow = dependencies.database.connection
        .prepare(`SELECT COUNT(*) AS total FROM campaigns ${where}`)
        .get(...parameters) as { total: number };
      const rows = dependencies.database.connection
        .prepare(
          `SELECT * FROM campaigns ${where}
           ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(
          ...parameters,
          query.limit,
          (query.page - 1) * query.limit,
        ) as CampaignRow[];
      return pageResult(
        rows.map(serializeCampaign),
        query.page,
        query.limit,
        totalRow.total,
      );
    },
  );

  app.get(
    "/campaigns/:id",
    {
      schema: {
        tags: ["Campaigns"],
        summary: "Get campaign details, milestones, and held-fund progress",
        params: registerOpenApiSchema(campaignParamsSchema),
        response: withErrors({
          200: {
            type: "object",
            allOf: [
              campaignSchema,
              {
                properties: {
                  milestones: {
                    type: "array",
                    items: {
                      type: "object",
                      required: [
                        "index",
                        "description",
                        "amount",
                        "status",
                        "evidence_hash",
                        "evidence_uri",
                        "window_end",
                        "released_amount",
                      ],
                      properties: {
                        index: { type: "integer", minimum: 0 },
                        description: { type: "string" },
                        amount: stringIntegerSchema,
                        status: {
                          type: "string",
                          enum: ["Pending", "EvidenceSubmitted", "Released"],
                        },
                        evidence_hash: { type: "string" },
                        evidence_uri: { type: "string" },
                        window_end: { type: "integer" },
                        released_amount: stringIntegerSchema,
                      },
                    },
                  },
                },
              },
            ],
          },
        }),
      },
    },
    async (request) => {
      const { id } = validateParams(campaignParamsSchema, request.params);
      const campaign = campaignOrNotFound(dependencies, id);
      return {
        ...serializeCampaign(campaign),
        milestones: campaignMilestones(dependencies, id).map((milestone) => ({
          index: milestone.milestone_index,
          description: milestone.description,
          amount: milestone.amount,
          status: milestone.status,
          evidence_hash: milestone.evidence_hash,
          evidence_uri: milestone.evidence_uri,
          window_end: milestone.window_end,
          released_amount: milestone.released_amount,
        })),
      };
    },
  );

  app.get(
    "/campaigns/:id/donations",
    {
      schema: {
        tags: ["Campaigns"],
        summary: "List donor positions and current withdrawable amounts",
        params: registerOpenApiSchema(campaignParamsSchema),
        querystring: donationsQueryJsonSchema,
        response: withErrors({
          200: pageResponseSchema(donationSchema),
        }),
      },
    },
    async (request) => {
      const { id } = validateParams(campaignParamsSchema, request.params);
      const campaign = campaignOrNotFound(dependencies, id);
      const query = validateQuery(donationsQuerySchema, request.query);
      const totalRow = dependencies.database.connection
        .prepare(
          "SELECT COUNT(*) AS total FROM donations WHERE campaign_id = ?",
        )
        .get(id) as { total: number };
      const rows = dependencies.database.connection
        .prepare(
          `SELECT campaign_id, donor, amount, shares, withdrawn, position_epoch, updated_ledger
           FROM donations WHERE campaign_id = ? ORDER BY amount DESC LIMIT ? OFFSET ?`,
        )
        .all(id, query.limit, (query.page - 1) * query.limit) as DonationRow[];
      const milestones = campaignMilestones(dependencies, id);
      const mayWithdraw = isWithdrawable(
        campaign,
        milestones,
        Math.floor(Date.now() / 1000),
      );
      const data = await Promise.all(
        rows.map(async (row) => {
          const position = await positionFor(
            dependencies,
            campaign,
            row.donor,
            row.position_epoch,
            row.shares,
            row.withdrawn,
          );
          return {
            campaign_id: row.campaign_id,
            donor: row.donor,
            amount: row.amount,
            shares: position.shares,
            current_value: position.value,
            withdrawn: position.withdrawn,
            withdrawable: mayWithdraw && BigInt(position.value) > 0n,
            updated_ledger: row.updated_ledger,
          };
        }),
      );
      return pageResult(data, query.page, query.limit, totalRow.total);
    },
  );

  app.get(
    "/campaigns/:id/timeline",
    {
      schema: {
        tags: ["Campaigns"],
        summary: "Get ordered on-chain events for a campaign",
        params: registerOpenApiSchema(campaignParamsSchema),
        querystring: donationsQueryJsonSchema,
        response: withErrors({
          200: pageResponseSchema(eventSchema),
        }),
      },
    },
    async (request) => {
      const { id } = validateParams(campaignParamsSchema, request.params);
      campaignOrNotFound(dependencies, id);
      const query = validateQuery(donationsQuerySchema, request.query);
      const totalRow = dependencies.database.connection
        .prepare(
          `SELECT COUNT(*) AS total FROM events
           WHERE CAST(json_extract(payload_json, '$.topics[1]') AS INTEGER) = ?`,
        )
        .get(id) as { total: number };
      const rows = dependencies.database.connection
        .prepare(
          `SELECT event_id, tx_hash, ledger, timestamp, type, payload_json, explorer_url
           FROM events
           WHERE CAST(json_extract(payload_json, '$.topics[1]') AS INTEGER) = ?
           ORDER BY ledger ASC, event_id ASC LIMIT ? OFFSET ?`,
        )
        .all(id, query.limit, (query.page - 1) * query.limit) as Array<{
        event_id: string;
        tx_hash: string;
        ledger: number;
        timestamp: string;
        type: string;
        payload_json: string;
        explorer_url: string;
      }>;
      return pageResult(
        rows.map((row) => ({
          event_id: row.event_id,
          tx_hash: row.tx_hash,
          ledger: row.ledger,
          timestamp: row.timestamp,
          type: row.type,
          payload: JSON.parse(row.payload_json) as unknown,
          explorer_url: row.explorer_url,
        })),
        query.page,
        query.limit,
        totalRow.total,
      );
    },
  );

  app.get(
    "/campaigns/:id/audit",
    {
      schema: {
        tags: ["Audit"],
        summary:
          "Compare one campaign's indexed totals with its on-chain getters",
        params: registerOpenApiSchema(campaignParamsSchema),
        response: withErrors({
          200: {
            type: "object",
            required: [
              "campaign_id",
              "accounting",
              "on_chain",
              "consistent",
              "verified_at",
            ],
            properties: {
              campaign_id: { type: "integer" },
              accounting: {
                type: "object",
                properties: {
                  total_donated: stringIntegerSchema,
                  total_released: stringIntegerSchema,
                  total_withdrawn: stringIntegerSchema,
                  held: stringIntegerSchema,
                },
              },
              on_chain: {
                type: "object",
                properties: {
                  total_raised: stringIntegerSchema,
                  total_released: stringIntegerSchema,
                  total_withdrawn: stringIntegerSchema,
                  held: stringIntegerSchema,
                },
              },
              consistent: { type: "boolean" },
              verified_at: { type: "string", format: "date-time" },
            },
          },
        }),
      },
    },
    async (request) => {
      const { id } = validateParams(campaignParamsSchema, request.params);
      const campaign = campaignOrNotFound(dependencies, id);
      const chainCampaign = await getOnChainCampaign(
        dependencies,
        requireContractId(dependencies.contractId),
        id,
      );
      const donations = dependencies.database.connection
        .prepare("SELECT amount FROM donations WHERE campaign_id = ?")
        .all(id) as Array<{ amount: string }>;
      const totalDonated = donations
        .reduce((sum, donation) => sum + amount(donation.amount), 0n)
        .toString();
      const consistent =
        totalDonated === campaign.total_raised &&
        chainCampaign.total_raised.toString() === campaign.total_raised &&
        chainCampaign.total_released.toString() === campaign.total_released &&
        chainCampaign.total_withdrawn.toString() === campaign.total_withdrawn &&
        chainCampaign.held.toString() === campaign.held;
      return {
        campaign_id: id,
        accounting: {
          total_donated: totalDonated,
          total_released: campaign.total_released,
          total_withdrawn: campaign.total_withdrawn,
          held: campaign.held,
        },
        on_chain: {
          total_raised: chainCampaign.total_raised.toString(),
          total_released: chainCampaign.total_released.toString(),
          total_withdrawn: chainCampaign.total_withdrawn.toString(),
          held: chainCampaign.held.toString(),
        },
        consistent,
        verified_at: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/audit/solvency",
    {
      schema: {
        tags: ["Audit"],
        summary:
          "Compare each token contract balance with all campaign-held funds and bonds",
        response: withErrors({
          200: {
            type: "object",
            required: ["tokens", "consistent", "verified_at"],
            properties: {
              tokens: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "token",
                    "contract_balance",
                    "expected_balance",
                    "campaign_count",
                    "campaigns",
                    "consistent",
                  ],
                  properties: {
                    token: { type: "string" },
                    contract_balance: stringIntegerSchema,
                    expected_balance: stringIntegerSchema,
                    campaign_count: { type: "integer", minimum: 0 },
                    campaigns: {
                      type: "array",
                      items: {
                        type: "object",
                        required: [
                          "campaign_id",
                          "held",
                          "bond_amount",
                          "bond_state",
                        ],
                        properties: {
                          campaign_id: { type: "integer", minimum: 1 },
                          held: stringIntegerSchema,
                          bond_amount: stringIntegerSchema,
                          bond_state: {
                            type: "string",
                            enum: ["Held", "Returned", "Slashed"],
                          },
                        },
                      },
                    },
                    consistent: { type: "boolean" },
                  },
                },
              },
              consistent: { type: "boolean" },
              verified_at: { type: "string", format: "date-time" },
            },
          },
        }),
      },
    },
    async () => {
      const contractId = requireContractId(dependencies.contractId);
      const tokens = dependencies.database.connection
        .prepare("SELECT DISTINCT token FROM campaigns ORDER BY token")
        .all() as Array<{ token: string }>;
      const details = await Promise.all(
        tokens.map(async ({ token }) => {
          const campaigns = dependencies.database.connection
            .prepare(
              `SELECT id, held, bond_amount, bond_state FROM campaigns WHERE token = ?`,
            )
            .all(token) as Array<{
            id: number;
            held: string;
            bond_amount: string;
            bond_state: string;
          }>;
          const expected = campaigns
            .reduce(
              (sum, campaign) =>
                sum +
                amount(campaign.held) +
                (campaign.bond_state === "Held"
                  ? amount(campaign.bond_amount)
                  : 0n),
              0n,
            )
            .toString();
          const balanceResponse =
            await dependencies.rpcServer.queryContract<unknown>(
              token,
              "balance",
              { id: contractId },
              dependencies.networkPassphrase,
            );
          const balance = amount(
            unwrapRpcValue<string | bigint>(
              balanceResponse.result,
              "token balance",
            ),
          ).toString();
          return {
            token,
            contract_balance: balance,
            expected_balance: expected,
            campaign_count: campaigns.length,
            campaigns: campaigns.map((campaign) => ({
              campaign_id: campaign.id,
              held: campaign.held,
              bond_amount:
                campaign.bond_state === "Held" ? campaign.bond_amount : "0",
              bond_state: campaign.bond_state,
            })),
            consistent: balance === expected,
          };
        }),
      );
      return {
        tokens: details,
        consistent: details.every((detail) => detail.consistent),
        verified_at: new Date().toISOString(),
      };
    },
  );

  app.get(
    "/donors/:address/donations",
    {
      schema: {
        tags: ["Donors"],
        summary: "List donations made by a Stellar account",
        params: registerOpenApiSchema(donorParamsSchema),
        querystring: donationsQueryJsonSchema,
        response: withErrors({
          200: pageResponseSchema(donationSchema),
        }),
      },
    },
    async (request) => {
      const { address } = validateParams(donorParamsSchema, request.params);
      const query = validateQuery(donationsQuerySchema, request.query);
      const totalRow = dependencies.database.connection
        .prepare("SELECT COUNT(*) AS total FROM donations WHERE donor = ?")
        .get(address) as { total: number };
      const rows = dependencies.database.connection
        .prepare(
          `SELECT d.campaign_id, d.donor, d.amount, d.shares, d.withdrawn,
                  d.position_epoch, d.updated_ledger, c.title, c.status,
                  c.held, c.total_shares, c.epoch, c.deadline, c.bond_amount,
                  c.bond_state, c.total_released, c.total_raised, c.org,
                  c.token, c.description_uri, c.goal, c.window_secs,
                  c.total_withdrawn, c.updated_ledger AS campaign_updated_ledger
           FROM donations d JOIN campaigns c ON c.id = d.campaign_id
           WHERE d.donor = ? ORDER BY d.updated_ledger DESC LIMIT ? OFFSET ?`,
        )
        .all(address, query.limit, (query.page - 1) * query.limit) as Array<
        DonationRow & {
          title: string;
          status: string;
          held: string;
          total_shares: string;
          epoch: number;
          deadline: number;
          bond_amount: string;
          bond_state: string;
          total_released: string;
          total_raised: string;
          org: string;
          token: string;
          description_uri: string;
          goal: string;
          window_secs: number;
          total_withdrawn: string;
          campaign_updated_ledger: number;
        }
      >;
      const now = Math.floor(Date.now() / 1000);
      const data = await Promise.all(
        rows.map(async (row) => {
          const campaign = campaignOrNotFound(dependencies, row.campaign_id);
          const position = await positionFor(
            dependencies,
            campaign,
            row.donor,
            row.position_epoch,
            row.shares,
            row.withdrawn,
          );
          return {
            campaign_id: row.campaign_id,
            donor: row.donor,
            amount: row.amount,
            shares: position.shares,
            current_value: position.value,
            withdrawn: position.withdrawn,
            withdrawable:
              isWithdrawable(
                campaign,
                campaignMilestones(dependencies, row.campaign_id),
                now,
              ) && BigInt(position.value) > 0n,
            updated_ledger: row.updated_ledger,
            title: row.title,
            status: row.status,
          };
        }),
      );
      return pageResult(data, query.page, query.limit, totalRow.total);
    },
  );

  app.get(
    "/stats",
    {
      schema: {
        tags: ["Statistics"],
        summary: "Get donation, campaign, donor, and release totals",
        response: withErrors({
          200: {
            type: "object",
            required: [
              "total_donated",
              "campaign_count",
              "donor_count",
              "total_released",
            ],
            properties: {
              total_donated: stringIntegerSchema,
              campaign_count: { type: "integer" },
              donor_count: { type: "integer" },
              total_released: stringIntegerSchema,
            },
          },
        }),
      },
    },
    async () => {
      const campaigns = dependencies.database.connection
        .prepare("SELECT total_released FROM campaigns")
        .all() as Array<{ total_released: string }>;
      const donations = dependencies.database.connection
        .prepare("SELECT amount FROM donations")
        .all() as Array<{ amount: string }>;
      const donors = dependencies.database.connection
        .prepare("SELECT COUNT(DISTINCT donor) AS total FROM donations")
        .get() as { total: number };
      return {
        total_donated: donations
          .reduce((sum, donation) => sum + amount(donation.amount), 0n)
          .toString(),
        campaign_count: campaigns.length,
        donor_count: donors.total,
        total_released: campaigns
          .reduce((sum, campaign) => sum + amount(campaign.total_released), 0n)
          .toString(),
      };
    },
  );

  app.post(
    "/tx/create-campaign",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Assemble a simulated, unsigned campaign creation transaction",
        body: registerOpenApiSchema(createCampaignSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => {
      const input = validateBody(createCampaignSchema, request.body);
      return {
        xdr: await dependencies.transactionService.createCampaign({
          ...input,
          window_secs: input.window_seconds,
        }),
        signed: false,
      };
    },
  );

  app.post(
    "/tx/donate",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Assemble a simulated, unsigned donation transaction",
        body: registerOpenApiSchema(donateSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.donate(
        validateBody(donateSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/submit-evidence",
    {
      schema: {
        tags: ["Transactions"],
        summary:
          "Assemble a simulated, unsigned milestone evidence transaction",
        body: registerOpenApiSchema(submitEvidenceSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.submitEvidence(
        validateBody(submitEvidenceSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/approve-milestone",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Removed: milestones no longer require third-party approvals",
        response: withErrors({
          410: {
            ...errorSchema,
            description: "This approval workflow has been removed.",
          },
        }),
      },
    },
    async (_request, reply) =>
      reply
        .code(410)
        .send(
          asErrorResponse(
            "ENDPOINT_REMOVED",
            "Las aprobaciones de verificadores fueron eliminadas; use la salida individual del donante y la liberación pública.",
          ),
        ),
  );

  app.post(
    "/tx/withdraw",
    {
      schema: {
        tags: ["Transactions"],
        summary:
          "Assemble an unsigned transaction to withdraw the donor position",
        body: registerOpenApiSchema(withdrawSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.withdraw(
        validateBody(withdrawSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/claim-refund",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Deprecated alias for /tx/withdraw",
        deprecated: true,
        body: registerOpenApiSchema(withdrawSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.withdraw(
        validateBody(withdrawSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/release-milestone",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Assemble a public milestone release transaction",
        body: registerOpenApiSchema(releaseMilestoneSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.releaseMilestone(
        validateBody(releaseMilestoneSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/reclaim-bond",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Assemble an unsigned creator bond reclamation transaction",
        body: registerOpenApiSchema(reclaimBondSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.reclaimBond(
        validateBody(reclaimBondSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/submit",
    {
      schema: {
        tags: ["Transactions"],
        summary:
          "Submit a wallet-signed transaction XDR and wait for confirmation",
        body: registerOpenApiSchema(submitTransactionSchema),
        response: withErrors({
          200: {
            type: "object",
            required: ["hash", "status", "explorer_url"],
            properties: {
              hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
              status: { type: "string", enum: ["SUCCESS"] },
              explorer_url: { type: "string", format: "uri" },
            },
          },
          202: {
            type: "object",
            required: ["hash", "status", "explorer_url"],
            properties: {
              hash: { type: "string" },
              status: { type: "string", enum: ["PENDING"] },
              explorer_url: { type: "string", format: "uri" },
            },
          },
        }),
      },
    },
    async (request, reply) => {
      try {
        return await dependencies.transactionService.submitSignedXdr(
          validateBody(submitTransactionSchema, request.body).xdr,
        );
      } catch (error) {
        if (error instanceof TransactionPendingError) {
          return reply.code(202).send({
            hash: error.hash,
            status: "PENDING",
            explorer_url: `https://stellar.expert/explorer/${dependencies.network}/tx/${error.hash}`,
          });
        }
        throw error;
      }
    },
  );

  app.post(
    "/evidence/upload",
    {
      schema: {
        tags: ["Evidence"],
        summary: "Upload a PDF, PNG, or JPEG evidence file (maximum 10 MB)",
        response: withErrors({
          201: {
            type: "object",
            required: ["hash", "uri", "content_type"],
            properties: {
              hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
              uri: { type: "string" },
              content_type: {
                type: "string",
                enum: ["application/pdf", "image/png", "image/jpeg"],
              },
            },
          },
        }),
      },
    },
    async (request, reply) => {
      const upload = await request.file({
        limits: { fileSize: 10 * 1024 * 1024, files: 1 },
      });
      if (!upload) {
        throw new ApiError(400, "FILE_REQUIRED", "A file is required.");
      }
      const file = await upload.toBuffer();
      const contentType = assertUploadType(file, upload.mimetype);
      const hash = createHash("sha256").update(file).digest("hex");
      const uri = await dependencies.storageProvider.save(hash, file);
      return reply.code(201).send({ hash, uri, content_type: contentType });
    },
  );

  app.get(
    "/evidence/:hash",
    {
      schema: {
        tags: ["Evidence"],
        summary: "Download a previously uploaded evidence file by SHA-256 hash",
        params: registerOpenApiSchema(evidenceParamsSchema),
        response: withErrors({
          200: { type: "string", format: "binary" },
        }),
      },
    },
    async (request, reply) => {
      const { hash } = validateParams(evidenceParamsSchema, request.params);
      const file = await readEvidence(dependencies.storageProvider, hash);
      const mimeType =
        file.subarray(0, 5).toString("ascii") === "%PDF-"
          ? "application/pdf"
          : file
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "image/png"
            : "image/jpeg";
      return reply.type(mimeType).send(file);
    },
  );

  app.get(
    "/evidence/:hash/verify",
    {
      schema: {
        tags: ["Evidence"],
        summary:
          "Recalculate the file hash and compare with indexed on-chain evidence",
        params: registerOpenApiSchema(evidenceParamsSchema),
        response: withErrors({
          200: {
            type: "object",
            required: [
              "hash",
              "calculated_hash",
              "file_matches_hash",
              "on_chain",
              "campaign_id",
              "milestone_index",
              "verified",
            ],
            properties: {
              hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
              calculated_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
              file_matches_hash: { type: "boolean" },
              on_chain: { type: "boolean" },
              campaign_id: { type: ["integer", "null"] },
              milestone_index: { type: ["integer", "null"] },
              verified: { type: "boolean" },
            },
          },
        }),
      },
    },
    async (request) => {
      const { hash } = validateParams(evidenceParamsSchema, request.params);
      const file = await readEvidence(dependencies.storageProvider, hash);
      const calculatedHash = createHash("sha256").update(file).digest("hex");
      const onChainRecord = dependencies.database.connection
        .prepare(
          `SELECT campaign_id, milestone_index FROM milestones
           WHERE evidence_hash = ? LIMIT 1`,
        )
        .get(hash) as
        { campaign_id: number; milestone_index: number } | undefined;
      return {
        hash,
        calculated_hash: calculatedHash,
        file_matches_hash: calculatedHash === hash,
        on_chain: onChainRecord !== undefined,
        campaign_id: onChainRecord?.campaign_id ?? null,
        milestone_index: onChainRecord?.milestone_index ?? null,
        verified: calculatedHash === hash && onChainRecord !== undefined,
      };
    },
  );
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (
      error: Error & { statusCode?: number; code?: string },
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (error instanceof ApiError) {
        return reply
          .code(error.statusCode)
          .send(asErrorResponse(error.code, error.message));
      }
      if (error instanceof TransactionInputError) {
        return reply
          .code(400)
          .send(asErrorResponse("INVALID_TRANSACTION", error.message));
      }
      if (error.code === "FST_ERR_VALIDATION") {
        return reply
          .code(400)
          .send(
            asErrorResponse(
              "INVALID_REQUEST",
              "Request parameters do not match the documented schema.",
            ),
          );
      }
      if (error.code === "FST_REQ_FILE_TOO_LARGE" || error.statusCode === 413) {
        return reply
          .code(413)
          .send(
            asErrorResponse(
              "FILE_TOO_LARGE",
              "Evidence files cannot exceed 10 MB.",
            ),
          );
      }
      if (error.statusCode === 429) {
        return reply
          .code(429)
          .send(asErrorResponse("RATE_LIMITED", "Too many requests."));
      }
      request.log.error({ err: error }, "Request failed.");
      return reply
        .code(500)
        .send(asErrorResponse("INTERNAL_ERROR", "An internal error occurred."));
    },
  );
}
