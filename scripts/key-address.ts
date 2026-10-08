import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { Keypair } from "@clearfun/sdk";

config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const secret = process.env.DEPLOYER_SECRET;
if (!secret) {
  throw new Error("DEPLOYER_SECRET is required.");
}

console.log(Keypair.fromSecret(secret).publicKey());
