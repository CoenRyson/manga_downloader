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
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173",
    url: "http://localhost:4173/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
