import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Keypair } from "@clearfun/sdk";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const actors = [
  { role: "organizacion", variable: "SMOKE_ORG_SECRET" },
  { role: "donante_1", variable: "SMOKE_DONOR_SECRET" },
  { role: "donante_2", variable: "SMOKE_DONOR_2_SECRET" },
  { role: "donante_3", variable: "SMOKE_DONOR_3_SECRET" },
  { role: "verificador_1", variable: "SMOKE_VERIFIER_1_SECRET" },
  { role: "verificador_2", variable: "SMOKE_VERIFIER_2_SECRET" },
] as const;

const publicActors = actors.map(({ role, variable }) => {
  const secret = process.env[variable];
  if (!secret) {
    throw new Error(`Missing local environment variable ${variable}.`);
  }
  return { role, public_key: Keypair.fromSecret(secret).publicKey() };
});

console.log(JSON.stringify(publicActors, null, 2));
