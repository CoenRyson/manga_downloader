import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 40_000,
  expect: { timeout: 8_000 },
  reporter: "line",
  use: {
    baseURL: "http://localhost:4173",
    channel: process.platform === "win32" ? "chrome" : undefined,
    trace: "retain-on-failure",
  },
  projects: [{ name: "nas-desktop", use: { viewport: { width: 1280, height: 800 } } }],
  webServer: {
    command: "node dist/nas/server.mjs",
    url: "http://localhost:4173/",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { HOST: "127.0.0.1", PORT: "4173" },
  },
});
