import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Contract checks against the deployed backend. Kept out of the default run
// so `npm test` stays offline and fast.
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["app/**/*.integration.test.ts"],
    testTimeout: 30_000,
  },
});
