import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpc } from "@stellar/stellar-sdk";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { IndexerDatabase } from "./indexer/database.js";
import { SorobanEventIndexer } from "./indexer/indexer.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
loadDotEnv({ path: resolve(repositoryRoot, ".env") });
const config = loadConfig();
const databaseUrl =
  config.DATABASE_URL === ":memory:"
    ? config.DATABASE_URL
    : resolve(repositoryRoot, config.DATABASE_URL);
const database = new IndexerDatabase(databaseUrl);
const rpcServer = new rpc.Server(config.SOROBAN_RPC_URL);
const app = buildApp({
  config: {
    ...config,
    EVIDENCE_STORAGE_DIR: resolve(repositoryRoot, config.EVIDENCE_STORAGE_DIR),
  },
  database,
  rpcServer,
});
const indexer = config.CONTRACT_ID
  ? new SorobanEventIndexer({
      rpcServer,
      database,
      contractId: config.CONTRACT_ID,
      networkPassphrase: config.NETWORK_PASSPHRASE,
      network: config.STELLAR_NETWORK,
      pollIntervalMs: config.INDEXER_POLL_INTERVAL_MS,
      startLedger: config.INDEXER_START_LEDGER,
      logger: app.log,
    })
  : undefined;

if (indexer) {
  indexer.start();
} else {
  app.log.warn(
    "CONTRACT_ID is empty; the API will start without the Soroban event indexer.",
  );
}

app.addHook("onClose", async () => {
  await indexer?.stop();
  database.close();
});

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
