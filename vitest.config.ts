import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://metering:metering_dev_password@localhost:5432/metering",
    },
  },
});