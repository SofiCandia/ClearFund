import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("backend setup", () => {
  it("serves a health check", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("validates and defaults backend configuration", () => {
    const config = loadConfig({});

    expect(config.STELLAR_NETWORK).toBe("testnet");
    expect(config.PORT).toBe(3000);
  });
});
