import { test, expect } from "@playwright/test";
import { desktop } from "./helpers/desktop";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=";
test("перенос: Save, отмена Open, предпросмотр, подтверждение замены и ошибка", async ({
  page,
}) => {
  let attempt = 0;
  const applied: Record<string, unknown>[] = [];
  await desktop(page, {
    export_library: () => "C:\\Transfer\\AnimDesk.json",
    preview_import: () =>
      ++attempt === 1
        ? null
        : {
            token: "preview-1",
            animeCount: 2,
            entryCount: 2,
            ratingCount: 1,
            profileName: "Анна",
          },
    cancel_import: () => null,
    apply_import: (args) => {
      applied.push(args);
      if (applied.length === 1)
        throw new Error("Конфликт ID. Транзакция отменена.");
      return "C:\\Data\\backups\\before.json";
    },
  });
  await page.goto("/#/settings");
  await page.getByRole("button", { name: "Экспортировать библиотеку" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Библиотека сохранена" }),
  ).toContainText("AnimDesk.json");
  await page.getByRole("button", { name: "Импортировать библиотеку" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Импортировать библиотеку" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Аниме: 2");
  const apply = dialog.getByRole("button", { name: "Применить импорт" });
  await expect(apply).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("combobox").selectOption("replace");
  await expect(apply).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await apply.click();
  await expect(dialog.getByRole("alert")).toContainText("Конфликт ID");
  await expect(dialog).toBeVisible();
  await apply.click();
  await expect(dialog).toHaveCount(0);
  expect(applied[1]).toEqual({
    token: "preview-1",
    mode: "replace",
    confirmed: true,
  });
  await expect(
    page.getByRole("status").filter({ hasText: "Библиотека импортирована" }),
  ).toContainText("before.json");
});
test("аватар отображается после перезапуска, отмена выбора и сброс", async ({
  page,
}) => {
  let avatar: string | null = png;
  let selection: string | null = null;
  await desktop(page, {
    avatar_image: () => avatar,
    choose_avatar: () => selection,
    reset_avatar: () => {
      avatar = null;
      return null;
    },
  });
  await page.goto("/#/profile");
  const image = page.getByRole("img", { name: "Аватар профиля", exact: true });
  await expect(image).toBeVisible();
  await page.reload();
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Выбрать аватар" }).click();
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Сбросить аватар" }).click();
  await expect(
    page.getByRole("img", { name: "Стандартный аватар" }),
  ).toBeVisible();
  selection = png;
  await page.getByRole("button", { name: "Выбрать аватар" }).click();
  await expect(image).toBeVisible();
});
test("офлайн после перезагрузки: библиотека, локальный поиск, детали и кеш обложки", async ({
  page,
}) => {
  const backend = await desktop(page, {
    cover_image: () => ({ saved: true, data: png }),
  });
  backend.db.exec(
    "INSERT INTO anime(id,provider,provider_id,shikimori_id,title,cover_url,episodes_total,fetched_at) VALUES(1,'shikimori','100','100','Локальный сезон','https://shikimori.io/a.png',12,'2026-10-23T00:00:00Z'); INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,added_at,updated_at) VALUES('local-default',1,'watching',3,'2026-10-23T00:00:00Z','2026-10-23T00:00:00Z');",
  );
  backend.setOffline();
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "onLine", { get: () => false }),
  );
  await page.route("https://**/*", (route) => route.abort());
  await page.goto("/#/library");
  await page.reload();
  await expect(
    page.getByRole("img", { name: "Обложка «Локальный сезон»" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Поиск в библиотеке" });
  await search.fill("Локальный");
  await expect(
    page.getByText("Локальный сезон", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link")
    .filter({ hasText: "Локальный сезон" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Локальный сезон" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Поиск", exact: true }).click();
  await expect(page.getByText(/Нет сети\. Внешний поиск/)).toBeVisible();
});
