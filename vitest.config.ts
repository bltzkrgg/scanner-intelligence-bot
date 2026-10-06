import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    globals: false
  },
  resolve: {
    alias: {
      "@sti/analysis": `${root}packages/analysis/src/index.ts`,
      "@sti/benchmark": `${root}packages/benchmark/src/index.ts`,
      "@sti/database": `${root}packages/database/src/index.ts`,
      "@sti/gmgn": `${root}packages/gmgn/src/index.ts`,
      "@sti/report": `${root}packages/report/src/index.ts`,
      "@sti/shared": `${root}packages/shared/src/index.ts`
    }
  }
});
