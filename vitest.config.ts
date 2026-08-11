import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Deliberately does not load the React Router plugin: these are plain unit
// tests over app/lib and app/models, not route or component tests.
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    // Integration tests hit the deployed backend; run them with `npm run test:api`.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
