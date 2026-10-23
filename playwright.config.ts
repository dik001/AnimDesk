import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1420",
    browserName: "chromium",
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "wide", use: { viewport: { width: 1440, height: 900 } } },
    { name: "minimum", use: { viewport: { width: 1000, height: 650 } } },
  ],
});
