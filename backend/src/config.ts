import { z } from "zod";

const configSchema = z.object({
  STELLAR_NETWORK: z.string().default("testnet"),
  SOROBAN_RPC_URL: z.url().default("https://soroban-testnet.stellar.org"),
  HORIZON_URL: z.url().default("https://horizon-testnet.stellar.org"),
  NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),
  CONTRACT_ID: z.string().default(""),
  DEPLOYER_SECRET: z.string().default(""),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default("./data/app.db"),
  ADMIN_API_KEY: z.string().default(""),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(5000),
  INDEXER_START_LEDGER: z.coerce.number().int().min(0).default(0),
  ALLOWED_ORIGINS: z.string().default(""),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  EVIDENCE_STORAGE_DIR: z.string().min(1).default("./data/evidence"),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  return configSchema.parse(env);
}
