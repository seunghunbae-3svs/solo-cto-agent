import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,   // 30s per test — prevents infinite hangs in retry/watch tests
    hookTimeout: 15_000,   // 15s for beforeEach/afterEach
    forceExit: true,       // force exit after all tests complete (prevents dangling handles)
  },
});
