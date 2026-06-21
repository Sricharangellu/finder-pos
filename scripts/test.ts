import { spawn } from "node:child_process";
import { glob } from "node:fs/promises";
import { ensurePg } from "./pg-harness.js";

const { url, stop } = await ensurePg();

const testFiles = await glob("src/**/*.test.ts");

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, PG_POOL_MAX: "1", JWT_SECRET: process.env.JWT_SECRET ?? "test-secret-finder-pos" },
  },
);

child.on("exit", async (code, signal) => {
  await stop();
  process.exit(code ?? (signal ? 1 : 0));
});
