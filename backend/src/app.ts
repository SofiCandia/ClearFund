import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import { rpc } from "@stellar/stellar-sdk";
import { loadConfig } from "./config.js";
import { registerApiRoutes, installErrorHandler } from "./api/routes.js";
import { IndexerDatabase } from "./indexer/database.js";
import {
  DiskStorageProvider,
  type StorageProvider,
} from "./storage/storage-provider.js";
import { TransactionService } from "./transactions/transaction-service.js";

type BackendConfig = ReturnType<typeof loadConfig>;

export interface BuildAppOptions {
  config?: BackendConfig;
  database?: IndexerDatabase;
  rpcServer?: rpc.Server;
  transactionService?: Pick<
    TransactionService,
    | "createCampaign"
    | "donate"
    | "submitEvidence"
    | "withdraw"
    | "releaseMilestone"
    | "reclaimBond"
    | "submitSignedXdr"
  >;
  storageProvider?: StorageProvider;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const config = options.config ?? loadConfig();
  const database = options.database ?? new IndexerDatabase(":memory:");
  const rpcServer = options.rpcServer ?? new rpc.Server(config.SOROBAN_RPC_URL);
  const transactionService =
    options.transactionService ??
    new TransactionService({
      contractId: config.CONTRACT_ID,
      networkPassphrase: config.NETWORK_PASSPHRASE,
      rpcUrl: config.SOROBAN_RPC_URL,
      rpcServer,
      network: config.STELLAR_NETWORK,
    });
  const storageProvider =
    options.storageProvider ??
    new DiskStorageProvider(config.EVIDENCE_STORAGE_DIR);
  const app = Fastify({ logger: true });
  const allowedOrigins = config.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAnyOrigin =
    allowedOrigins.length === 1 && allowedOrigins[0] === "*";

  app.register(cors, {
    origin: allowAnyOrigin
      ? true
      : allowedOrigins.length > 0
        ? allowedOrigins
        : false,
    credentials: true,
  });
  app.register(helmet);
  app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
  });
  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  });
  app.register(swagger, {
    openapi: {
      info: {
        title: "ClearFun API",
        description:
          "Read-only campaign and audit data, wallet-signed Soroban transactions, and SHA-256 evidence storage.",
        version: "0.4.0",
      },
      servers: [
        {
          url: "/",
          description: "Current ClearFun API server",
        },
      ],
      tags: [
        { name: "System", description: "Service health" },
        {
          name: "Campaigns",
          description: "Campaigns, donations, and timeline",
        },
        { name: "Donors", description: "Donation history by wallet" },
        { name: "Statistics", description: "Aggregated platform statistics" },
        { name: "Audit", description: "Indexed/on-chain accounting checks" },
        {
          name: "Transactions",
          description: "Unsigned Soroban transaction XDR",
        },
        {
          name: "Evidence",
          description: "Evidence upload, download, and verification",
        },
      ],
    },
    transformObject: (documentObject) => {
      if (!("openapiObject" in documentObject)) return {};
      const document = documentObject.openapiObject;
      const paths = document.paths as unknown as
        Record<string, Record<string, Record<string, unknown>>> | undefined;
      const campaignCreate = paths?.["/tx/create-campaign"]?.post;
      if (campaignCreate) {
        const body = campaignCreate.requestBody as
          | {
              content?: {
                "application/json"?: { schema?: unknown };
              };
            }
          | undefined;
        campaignCreate.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: body?.content?.["application/json"]?.schema,
              example: {
                source:
                  "GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN",
                org: "GBZMF2I4QQCDVZY3R55F7667WQOBUALKBX6IPUMLAPNJCIU6KVLOPMHN",
                token:
                  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
                title: "Campaign",
                description_uri: "https://example.org/campaign",
                milestones: [{ description: "Phase one", amount: "100000" }],
                window_seconds: 259200,
                deadline: "1800000000",
              },
            },
          },
        };
      }
      const donation = paths?.["/tx/donate"]?.post;
      if (donation) {
        const body = donation.requestBody as
          | {
              content?: {
                "application/json"?: { schema?: unknown };
              };
            }
          | undefined;
        donation.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: body?.content?.["application/json"]?.schema,
              example: {
                source:
                  "GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
                donor:
                  "GA5CSTXBHKQTMCV75UWPFHLABDXTZO3NPXGMFJNW33KCDFXSCMNZOEQY",
                campaign_id: 1,
                amount: "100000",
              },
            },
          },
        };
      }
      const evidenceUpload = paths?.["/evidence/upload"]?.post;
      if (evidenceUpload) {
        evidenceUpload.requestBody = {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "PDF, PNG, or JPEG file; maximum 10 MB.",
                  },
                },
              },
            },
          },
        };
      }
      const download = paths?.["/evidence/{hash}"]?.get?.responses as
        Record<string, Record<string, unknown>> | undefined;
      if (download?.["200"]) {
        download["200"].content = {
          "application/pdf": { schema: { type: "string", format: "binary" } },
          "image/png": { schema: { type: "string", format: "binary" } },
          "image/jpeg": { schema: { type: "string", format: "binary" } },
        };
      }
      return document;
    },
  });
  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });

  installErrorHandler(app);
  app.addHook("onClose", async () => {
    if (!options.database) database.close();
  });
  app.after(() => {
    registerApiRoutes(app, {
      database,
      contractId: config.CONTRACT_ID,
      network: config.STELLAR_NETWORK,
      rpcServer,
      networkPassphrase: config.NETWORK_PASSPHRASE,
      transactionService,
      storageProvider,
    });
    app.get(
      "/docs/openapi.json",
      {
        schema: {
          hide: true,
        },
      },
      async () => app.swagger(),
    );
  });
  return app;
}
