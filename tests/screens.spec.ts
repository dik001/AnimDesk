import { expect, test } from "@playwright/test";
import { desktop } from "./helpers/desktop";

test("локальный профиль, статистика из SQLite и мгновенные изменения", async ({
  page,
}, info) => {
  const { db } = await desktop(page);
  try {
    await page.goto("/#/profile");
    const stats = page.getByRole("definition");
    await expect(stats.nth(0)).toHaveText("0");
    await expect(stats.nth(1)).toHaveText("0");
    await expect(stats.nth(2)).toHaveText("0%");
    await expect(
      page.getByText(/Время просмотра не отслеживается|Библиотека пока пуста/),
    ).toHaveCount(0);
    const created = db
      .prepare("SELECT created_at FROM profiles")
      .get()?.created_at;
    await page
      .getByRole("textbox", { name: "Имя профиля" })
      .fill("Мой профиль");
    await page.getByRole("textbox", { name: "Имя профиля" }).press("Enter");
    await expect(
      page.getByRole("heading", { name: "Мой профиль", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Имя профиля" }),
    ).toHaveValue("Мой профиль");
    expect(
      db.prepare("SELECT created_at FROM profiles").get()?.created_at,
    ).toBe(created);
    for (const [i, status] of [
      "watching",
      "planned",
      "completed",
      "on_hold",
      "dropped",
    ].entries()) {
      db.prepare(
        "INSERT INTO anime(id,provider,provider_id,title,fetched_at) VALUES(?,'shikimori',?,'Аниме','now')",
      ).run(i + 1, String(i + 1));
      db.prepare(
        "INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,added_at,updated_at) VALUES('local-default',?,?,?,'now','now')",
      ).run(i + 1, status, i + 1);
    }
    await page.evaluate(() =>
      window.dispatchEvent(new Event("animdesk:library-changed")),
    );
    await expect(stats.nth(0)).toHaveText("5");
    await expect(stats.nth(1)).toHaveText("15");
    await expect(stats.nth(2)).toHaveText("20%");
    for (let i = 3; i < 8; i++) await expect(stats.nth(i)).toHaveText("1");
    db.exec(
      "UPDATE library_entries SET watched_episodes=8 WHERE anime_id=1; DELETE FROM library_entries WHERE status='completed'",
    );
    await page.evaluate(() =>
      window.dispatchEvent(new Event("animdesk:library-changed")),
    );
    await expect(stats.nth(0)).toHaveText("4");
    await expect(stats.nth(1)).toHaveText("19");
    await expect(stats.nth(2)).toHaveText("0%");
    expect(
      await page
        .getByRole("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/profile-${info.project.name}.png`,
    });
  } finally {
    db.close();
  }
});

test("тема сохраняется после перезапуска, клавиатура и навигация", async ({
  page,
}, info) => {
  const { db } = await desktop(page);
  try {
    await page.goto("/#/settings");
    const theme = page.getByRole("combobox", { name: "Тема оформления" });
    await expect(theme).toHaveValue("dark");
    await theme.focus();
    await theme.press("ArrowDown");
    await theme.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(
      db.prepare("SELECT value FROM app_settings WHERE key='theme'").get()
        ?.value,
    ).toBe("light");
    await page.reload();
    await expect(theme).toHaveValue("light");
    await expect(
      page.getByText(
        "C:\\Users\\Test\\AppData\\Roaming\\app.anidesk.desktop\\anidesk.db",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/settings-light-${info.project.name}.png`,
    });
    await page.getByRole("link", { name: "Редактировать имя профиля" }).click();
    await expect(
      page.getByRole("heading", { name: "Профиль", exact: true }),
    ).toBeVisible();
    for (const [name, heading] of [
      ["Главная", "Главная"],
      ["Моя библиотека", "Моя библиотека"],
      ["Поиск", "Поиск аниме"],
      ["Настройки", "Настройки"],
    ]) {
      await page.getByRole("link", { name, exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      expect(
        await page
          .getByRole("main")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await page.goto("/#/anime/shikimori/100");
    await expect(
      page.getByRole("button", { name: "Добавить в список", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Описание сезона", { exact: true })).toHaveCSS(
      "color",
      "rgb(70, 59, 49)",
    );
    await page.screenshot({
      path: `docs/screenshots/anime-light-${info.project.name}.png`,
    });
    expect(
      await page
        .getByRole("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.getByRole("link", { name: "Настройки", exact: true }).click();
    await theme.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(theme).toHaveValue("dark");
  } finally {
    db.close();
  }
});

test("главная: watching, сбой API, офлайн-библиотека и возврат сети", async ({
  page,
}, info) => {
  const { db, setOffline, useReserve } = await desktop(page);
  try {
    useReserve();
    await page.goto("/#/anime/shikimori/100");
    // Add directly to SQLite: API fixtures remain only in the test transport.
    db.prepare(
      "INSERT INTO anime(id,provider,provider_id,title,episodes_total,fetched_at) VALUES(1,'shikimori','1','Локальная история',12,'now'),(2,'shikimori','2','В планах',NULL,'now')",
    ).run();
    db.exec(
      "INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,added_at,updated_at) VALUES('local-default',1,'watching',7,'now','now'),('local-default',2,'planned',0,'now','now')",
    );
    await page.goto("/#/");
    await expect(page.getByText("Отмечено серий: 7 / 12")).toBeVisible();
    await expect(page.getByRole("link", { name: "В планах" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить", exact: true })).toHaveCount(2);
    setOffline();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByText("Отмечено серий: 7 / 12")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Локальная библиотека" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /В планах/ })).toBeVisible();
    await page.context().setOffline(true);
    await expect(
      page.getByRole("heading", { name: "Локальная библиотека" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /В планах/ })).toBeVisible();
    await expect(
      page.getByText("Нет сети. Этот раздел обновится после подключения."),
    ).toHaveCount(2);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await page.screenshot({
      path: `docs/screenshots/home-offline-${info.project.name}.png`,
    });
    setOffline(false);
    await page.context().setOffline(false);
    await expect(
      page.getByRole("heading", { name: "Продолжить просмотр" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Повторить", exact: true })).toHaveCount(2);
  } finally {
    db.close();
  }
});

test("главная: основной API, динамический сезон и ограниченное ожидание", async ({
  page,
}) => {
  const { db, hangRequests } = await desktop(page);
  try {
    await page.clock.install({ time: new Date(2031, 3, 2, 12) });
    await page.goto("/#/");
    await expect(
      page.getByRole("heading", { name: "Аниме весеннего сезона" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Тестовый сезон/ }),
    ).toHaveCount(2);
    await expect(page.getByText(/Используется Jikan/)).toHaveCount(0);
    await expect(
      page.getByText("В списке «Смотрю» пока нет аниме."),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Найти аниме", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Имя профиля" }),
    ).toBeVisible();
    hangRequests();
    // Reload drops the in-memory catalogue cache; pending IPC must still time out.
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Имя профиля" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Главная", exact: true }).click();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(2);
    await page.clock.runFor(36_000);
    await expect(page.getByRole("alert")).toHaveCount(2);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(
      page.getByText("В локальной библиотеке пока нет аниме."),
    ).toBeVisible();
  } finally {
    db.close();
  }
});
