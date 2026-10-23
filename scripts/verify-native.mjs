import { chromium, expect } from "@playwright/test";

// Run against a development WebView2 started with a temporary local CDP port.
// No debug port is configured in the application or its release build.
const browser = await chromium.connectOverCDP("http://127.0.0.1:9238");
try {
  const pages = browser.contexts().flatMap((context) => context.pages());
  const page = pages.find((candidate) => candidate.url().startsWith("http://127.0.0.1:1420"));
  if (!page) throw new Error("Не найдена страница AnimDesk в WebView2");
  await expect(page.getByRole("heading", { name: "Главная", exact: true })).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/native.png" });
  await page.getByRole("link", { name: "Поиск", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Поиск аниме", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Главная", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Главная", exact: true })).toBeVisible();
  console.log("WebView2: главная, переход к поиску и возврат — успешно");
} finally {
  await browser.close();
}
