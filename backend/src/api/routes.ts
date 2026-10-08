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
    verifiers: z.array(addressSchema).min(1).max(32),
    threshold: z.number().int().positive().max(32),
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
    if (input.threshold > input.verifiers.length) {
      context.addIssue({
        code: "custom",
        path: ["threshold"],
        message: "threshold cannot exceed the verifier count.",
      });
    }
    if (new Set(input.verifiers).size !== input.verifiers.length) {
      context.addIssue({
        code: "custom",
        path: ["verifiers"],
        message: "Verifier addresses must be unique.",
      });
    }
    if (input.verifiers.includes(input.org)) {
      context.addIssue({
        code: "custom",
        path: ["verifiers"],
        message: "The organization cannot be a verifier.",
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
const approveMilestoneSchema = z
  .object({
    source: addressSchema,
    verifier: addressSchema,
    campaign_id: positiveIdSchema,
    milestone_index: z.number().int().nonnegative().max(31),
  })
  .refine((input) => input.source === input.verifier, {
    path: ["source"],
    message: "source must match the verifier wallet.",
  });
const claimRefundSchema = z
  .object({
    source: addressSchema,
    donor: addressSchema,
    campaign_id: positiveIdSchema,
  })
  .refine((input) => input.source === input.donor, {
    path: ["source"],
    message: "source must match the donor wallet.",
  });
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
  threshold: number;
  verifiers_json: string;
  total_raised: string;
  total_released: string;
  total_refunded: string;
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
  approvals_json: string;
  updated_ledger: number;
}

interface DonationRow {
  campaign_id: number;
  donor: string;
  amount: string;
  refunded_amount: string;
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
    | "approveMilestone"
    | "claimRefund"
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
  const raised = amount(campaign.total_raised);
  const released = amount(campaign.total_released);
  const refunded = amount(campaign.total_refunded);
  return {
    progress_percent: goal === 0n ? 0 : Number((raised * 10_000n) / goal) / 100,
    funds_held: (raised - released - refunded).toString(),
  };
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
    threshold: campaign.threshold,
    verifiers: JSON.parse(campaign.verifiers_json) as string[],
    total_raised: campaign.total_raised,
    total_released: campaign.total_released,
    total_refunded: campaign.total_refunded,
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
      "threshold",
      "verifiers",
      "total_raised",
      "total_released",
      "total_refunded",
      "status",
      "progress_percent",
      "funds_held",
    ],
    properties: {
      id: { type: "integer", minimum: 1 },
      org: { type: "string", description: "Organization Stellar address." },
      token: { type: "string", description: "Soroban token contract address." },
      title: { type: "string" },
      description_uri: { type: "string", format: "uri" },
      goal: stringIntegerSchema,
      deadline: { type: "integer", description: "Unix timestamp in seconds." },
      threshold: { type: "integer", minimum: 1 },
      verifiers: { type: "array", items: { type: "string" } },
      total_raised: stringIntegerSchema,
      total_released: stringIntegerSchema,
      total_refunded: stringIntegerSchema,
      status: {
        type: "string",
        enum: ["Active", "Completed", "Expired", "Cancelled"],
      },
      progress_percent: { type: "number", minimum: 0 },
      funds_held: stringIntegerSchema,
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
      "refunded_amount",
      "updated_ledger",
    ],
    properties: {
      campaign_id: { type: "integer" },
      donor: { type: "string" },
      amount: stringIntegerSchema,
      refunded_amount: stringIntegerSchema,
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
        summary: "Get a campaign, milestones, verifiers, and escrow progress",
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
                        "approvals",
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
                        approvals: { type: "array", items: { type: "string" } },
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
          approvals: JSON.parse(milestone.approvals_json) as string[],
        })),
      };
    },
  );

  app.get(
    "/campaigns/:id/donations",
    {
      schema: {
        tags: ["Campaigns"],
        summary: "List donors and donation amounts for a campaign",
        params: registerOpenApiSchema(campaignParamsSchema),
        querystring: donationsQueryJsonSchema,
        response: withErrors({
          200: pageResponseSchema(donationSchema),
        }),
      },
    },
    async (request) => {
      const { id } = validateParams(campaignParamsSchema, request.params);
      campaignOrNotFound(dependencies, id);
      const query = validateQuery(donationsQuerySchema, request.query);
      const totalRow = dependencies.database.connection
        .prepare(
          "SELECT COUNT(*) AS total FROM donations WHERE campaign_id = ?",
        )
        .get(id) as { total: number };
      const rows = dependencies.database.connection
        .prepare(
          `SELECT campaign_id, donor, amount, refunded_amount, updated_ledger
           FROM donations WHERE campaign_id = ? ORDER BY amount DESC LIMIT ? OFFSET ?`,
        )
        .all(id, query.limit, (query.page - 1) * query.limit) as DonationRow[];
      return pageResult(rows, query.page, query.limit, totalRow.total);
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
          "Compare indexed accounting with live contract and token state",
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
                  total_incoming: stringIntegerSchema,
                  total_released: stringIntegerSchema,
                  total_refunded: stringIntegerSchema,
                  total_outgoing: stringIntegerSchema,
                  expected_contract_balance: stringIntegerSchema,
                },
              },
              on_chain: {
                type: "object",
                properties: {
                  total_raised: stringIntegerSchema,
                  total_released: stringIntegerSchema,
                  contract_balance: stringIntegerSchema,
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
      const totalIncoming = donations
        .reduce((sum, donation) => sum + amount(donation.amount), 0n)
        .toString();
      const totalOutgoing = (
        amount(campaign.total_released) + amount(campaign.total_refunded)
      ).toString();
      const expectedBalance = (
        amount(totalIncoming) - amount(totalOutgoing)
      ).toString();
      const balanceResponse =
        await dependencies.rpcServer.queryContract<unknown>(
          chainCampaign.token,
          "balance",
          { id: requireContractId(dependencies.contractId) },
          dependencies.networkPassphrase,
        );
      const onChainBalance = amount(
        unwrapRpcValue<string | bigint>(
          balanceResponse.result,
          "token balance",
        ),
      ).toString();
      const consistent =
        totalIncoming === campaign.total_raised &&
        chainCampaign.total_raised.toString() === campaign.total_raised &&
        chainCampaign.total_released.toString() === campaign.total_released &&
        expectedBalance === onChainBalance;
      return {
        campaign_id: id,
        accounting: {
          total_incoming: totalIncoming,
          total_released: campaign.total_released,
          total_refunded: campaign.total_refunded,
          total_outgoing: totalOutgoing,
          expected_contract_balance: expectedBalance,
        },
        on_chain: {
          total_raised: chainCampaign.total_raised.toString(),
          total_released: chainCampaign.total_released.toString(),
          contract_balance: onChainBalance,
        },
        consistent,
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
          `SELECT d.campaign_id, d.donor, d.amount, d.refunded_amount,
                  d.updated_ledger, c.title, c.status
           FROM donations d JOIN campaigns c ON c.id = d.campaign_id
           WHERE d.donor = ? ORDER BY d.updated_ledger DESC LIMIT ? OFFSET ?`,
        )
        .all(address, query.limit, (query.page - 1) * query.limit);
      return pageResult(rows, query.page, query.limit, totalRow.total);
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
    async (request) => ({
      xdr: await dependencies.transactionService.createCampaign(
        validateBody(createCampaignSchema, request.body),
      ),
      signed: false,
    }),
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
        summary:
          "Assemble a simulated, unsigned milestone approval transaction",
        body: registerOpenApiSchema(approveMilestoneSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.approveMilestone(
        validateBody(approveMilestoneSchema, request.body),
      ),
      signed: false,
    }),
  );

  app.post(
    "/tx/claim-refund",
    {
      schema: {
        tags: ["Transactions"],
        summary: "Assemble a simulated, unsigned donation refund transaction",
        body: registerOpenApiSchema(claimRefundSchema),
        response: withErrors({ 200: txResponseSchema }),
      },
    },
    async (request) => ({
      xdr: await dependencies.transactionService.claimRefund(
        validateBody(claimRefundSchema, request.body),
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
