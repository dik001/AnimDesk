import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const databasePath = join(
  process.env.APPDATA,
  "app.anidesk.desktop",
  "anidesk.db",
);
const original = new DatabaseSync(databasePath, { readOnly: true });
if (
  original.prepare("SELECT COUNT(*) AS n FROM library_entries").get().n !== 0
) {
  original.close();
  throw new Error(
    "Нативный сценарий рассчитан на пустую библиотеку; существующие пользовательские записи не меняются.",
  );
}
original.close();
let processHandle;
let browser;
let createdTitle;
async function start() {
  processHandle = spawn(resolve("src-tauri/target/debug/animdesk.exe"), [], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9238",
    },
  });
  for (let i = 0; i < 60; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9238");
      const page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find(
          (p) =>
            p.url().includes("1420") || p.url().includes("tauri.localhost"),
        );
      if (page) return page;
      await browser.close();
    } catch {
      /* WebView2 is starting. */
    }
    await delay(500);
  }
  throw new Error("Нативный WebView2 не запустился за 30 секунд.");
}
async function stop() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
  if (processHandle && processHandle.exitCode === null) {
    const exited = new Promise((resolve) =>
      processHandle.once("exit", resolve),
    );
    processHandle.kill();
    await exited;
  }
  processHandle = undefined;
}
try {
  let page = await start();
  await page.getByRole("link", { name: "Поиск", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название аниме" })
    .fill("Bocchi the Rock!");
  await expect(
    page.locator('[aria-label="Результаты каталога"] a').first(),
  ).toBeVisible({ timeout: 40000 });
  await page.locator('[aria-label="Результаты каталога"] a').first().click();
  await expect(
    page.getByRole("button", { name: "Добавить в список", exact: true }),
  ).toBeVisible({ timeout: 40000 });
  createdTitle = await page.getByRole("heading", { level: 1 }).innerText();
  await page
    .getByRole("button", { name: "Добавить в список", exact: true })
    .click();
  let editor = page.getByRole("region", {
    name: `Библиотека: ${createdTitle}`,
  });
  await expect(editor).toBeVisible();
  await editor.getByRole("spinbutton").fill("7");
  await editor.getByRole("spinbutton").press("Enter");
  await expect
    .poll(() => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      const row = db
        .prepare("SELECT watched_episodes AS n FROM library_entries")
        .get();
      db.close();
      return row?.n;
    })
    .toBe(7);
  await editor.getByRole("combobox").selectOption("watching");
  await expect(editor.getByRole("combobox")).toHaveValue("watching");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const row = db
    .prepare(
      "SELECT watched_episodes,episodes_total FROM library_entries JOIN anime ON anime.id=anime_id",
    )
    .get();
  db.close();
  expect(row).toMatchObject({ watched_episodes: 7, episodes_total: 12 });
  await stop();
  page = await start();
  await page.getByRole("link", { name: "Моя библиотека", exact: true }).click();
  await expect(
    page.getByText("Смотрю · 7 / 12 серий", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "docs/screenshots/library-native.png" });
  await page.getByLabel(`Действия: ${createdTitle}`, { exact: true }).click();
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Редактирование аниме" });
  await dialog
    .getByRole("combobox", { name: "Список", exact: true })
    .selectOption("on_hold");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByText("Отложено · 7 / 12 серий", { exact: true }),
  ).toBeVisible();
  await page.getByLabel(`Действия: ${createdTitle}`, { exact: true }).click();
  await page
    .getByRole("button", { name: "Убрать из списка", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Убрать из списка?" })
    .getByRole("button", { name: "Подтвердить удаление" })
    .click();
  await expect(page.getByText("Здесь пока нет аниме")).toBeVisible();
  console.log(
    `Нативный Windows IPC + живой Shikimori: ${createdTitle}; 7/12 пережили закрытие процесса и повторный запуск; статус изменён; запись удалена, каталог сохранён.`,
  );
} finally {
  await stop();
}
