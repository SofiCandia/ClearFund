import { config as loadDotEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
loadDotEnv({ path: resolve(repositoryRoot, ".env") });
const config = loadConfig();
const app = buildApp({
  config: {
    ...config,
    EVIDENCE_STORAGE_DIR: resolve(repositoryRoot, config.EVIDENCE_STORAGE_DIR),
  },
});

try {
  await app.ready();
  const outputPath = resolve(repositoryRoot, "docs/openapi.json");
  await mkdir(resolve(repositoryRoot, "docs"), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(app.swagger(), null, 2)}\n`);
  console.log(`OpenAPI document written to ${outputPath}`);
} finally {
  await app.close();
}
