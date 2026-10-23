import { expect, test, type Page } from "@playwright/test";
import type { CatalogRequest } from "../src/services/catalog/types";
import type { AnimeUpsertInput } from "../src/types/storage";

async function mockDesktop(
  page: Page,
  mode:
    | "primary"
    | "reserve"
    | "offline"
    | "hang"
    | "hang_primary"
    | "hang_storage" = "primary",
) {
  await page.addInitScript(
    ({ mode }) => {
      let saved: Record<string, unknown> | undefined;
      Object.defineProperty(window, "isTauri", { value: true });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          invoke: async (command: string, args: Record<string, unknown>) => {
            if (command === "warm_covers") return null;
            if (command === "cover_image") return { saved: false, data: null };
            if (command === "plugin:sql|load") return "sqlite:anidesk.db";
            if (command === "plugin:sql|execute") return [1, 1];
            if (command === "plugin:sql|select") {
              const sql = String(args.query);
              if (mode === "hang_storage" && sql.includes("FROM anime"))
                return new Promise<unknown>(() => {});
              if (sql.includes("FROM profiles"))
                return [
                  {
                    id: "local-default",
                    displayName: "Пользователь",
                    avatarPath: null,
                    createdAt: "2026-01-01",
                  },
                ];
              if (sql.includes("FROM anime_titles")) return saved?.titles ?? [];
              if (sql.includes("FROM genres")) return [];
              if (sql.includes("FROM anime")) return saved ? [saved] : [];
              return [];
            }
            if (command === "upsert_anime") {
              const input = args.input as AnimeUpsertInput;
              saved = {
                ...input,
                id: 7,
                episodesTotal: input.episodesTotal,
                communityScore: input.communityScore,
              };
              return { animeId: 7 };
            }
            if (command !== "catalog_request")
              throw new Error(`Unexpected command: ${command}`);
            const r = args.request as CatalogRequest;
            if (
              mode === "hang" ||
              (mode === "hang_primary" && r.provider === "shikimori")
            )
              return new Promise<unknown>(() => {});
            if (
              mode === "offline" ||
              (mode === "reserve" && r.provider === "shikimori")
            )
              throw Object.assign(new Error("Нет связи с источником."), {
                code: "network",
                detail: "mock network",
              });
            if (r.operation === "genres")
              return r.provider === "shikimori"
                ? {
                    data: {
                      genres: [{ id: "99", name: "Drama", russian: "Драма" }],
                    },
                  }
                : { data: [{ mal_id: 8, name: "Drama" }] };
            if (r.query === "old")
              await new Promise((resolve) => setTimeout(resolve, 1500));
            const title =
              r.query === "new"
                ? "Новый результат"
                : r.query === "old"
                  ? "Устаревший результат"
                  : "Тетрадь смерти";
            const shiki = {
              id: "100",
              malId: "1535",
              name: "Death Note",
              russian: title,
              episodes: 37,
              airedOn: { year: 2006 },
              description: "Описание истории",
              poster: null,
            };
            const jikan = {
              mal_id: 1535,
              title: "Death Note",
              episodes: 37,
              year: 2006,
              synopsis: "Description",
            };
            if (r.operation === "detail")
              return r.provider === "shikimori"
                ? { data: { animes: [shiki] } }
                : { data: jikan };
            const items =
              r.query === "empty"
                ? []
                : r.page === 2
                  ? [{ ...shiki, id: "200", russian: "Вторая страница" }]
                  : r.query === "paged"
                    ? Array.from({ length: 20 }, (_, i) => ({
                        ...shiki,
                        id: String(100 + i),
                        russian: `Аниме ${i + 1}`,
                      }))
                    : [shiki];
            return r.provider === "shikimori"
              ? { data: { animes: items } }
              : { data: [jikan], pagination: { has_next_page: false } };
          },
        },
      });
    },
    { mode },
  );
}
test("реальные маршруты через mock IPC: поиск, пагинация, очистка и карточка", async ({
  page,
}) => {
  await mockDesktop(page);
  await page.goto("/#/search");
  const query = page.getByRole("textbox", { name: "Название аниме" });
  await query.fill("paged");
  await expect(page.getByRole("link", { name: /Аниме 20/ })).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(
    page.getByText("Вторая страница", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await query.fill("empty");
  await expect(page.getByText(/Ничего не найдено/)).toBeVisible();
  await query.fill("Death Note");
  const card = page.getByRole("link", { name: /Тетрадь смерти/ });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/anime\/shikimori\/100/);
  await expect(
    page.getByRole("heading", {
      name: "Тетрадь смерти",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Описание истории", { exact: true }),
  ).toBeVisible();
  await page.goto("/#/search");
  await query.fill("Death Note");
  await page.getByRole("button", { name: "Очистить" }).click();
  await expect(query).toHaveValue("");
  await expect(query).toBeFocused();
});
test("сбой Shikimori не подменяется результатами другого каталога", async ({ page }) => {
  await mockDesktop(page, "reserve");
  await page.goto("/#/search");
  await page.getByRole("textbox", { name: "Название аниме" }).fill("Death Note");
  await expect(page.getByText("Нет связи с источником.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Death Note/ })).toHaveCount(0);
});
test("новый запрос вытесняет медленный устаревший ответ", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/#/search");
  const query = page.getByRole("textbox", { name: "Название аниме" });
  await query.fill("old");
  await page.waitForTimeout(550);
  await query.fill("new");
  await expect(
    page.getByText("Новый результат", { exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(1700);
  await expect(
    page.getByText("Устаревший результат", { exact: true }),
  ).toHaveCount(0);
});
test("сбой обоих источников показывает ошибку и позволяет повторить", async ({
  page,
}) => {
  await mockDesktop(page, "offline");
  await page.goto("/#/search");
  await page
    .getByRole("textbox", { name: "Название аниме" })
    .fill("Death Note");
  await expect(
    page.getByText("Нет связи с источником.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeEnabled();
});

test("зависший основной IPC ограничен по времени и показывает ошибку", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page, "hang_primary");
  await page.goto("/#/search");
  await page
    .getByRole("textbox", { name: "Название аниме" })
    .fill("Death Note");
  await page.clock.runFor(500);
  await page.clock.runFor(14_100);
  await expect(page.getByRole("button", { name: "Повторить", exact: true })).toBeEnabled();
  await expect(page.getByRole("link", { name: /Death Note/ })).toHaveCount(0);
});
test("зависание обоих IPC завершается ошибкой вместо бесконечного скелетона", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page, "hang");
  await page.goto("/#/search");
  await page
    .getByRole("textbox", { name: "Название аниме" })
    .fill("Death Note");
  await page.clock.runFor(500);
  await page.clock.runFor(14_100);
  await page.clock.runFor(14_100);
  await expect(
    page.getByText("Источник не ответил вовремя. Повторите запрос.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeEnabled();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
});
test("общий предел UI завершает даже зависшее чтение локальной карточки", async ({
  page,
}) => {
  await page.clock.install();
  await mockDesktop(page, "hang_storage");
  await page.goto("/#/anime/shikimori/100");
  await expect(
    page.getByRole("heading", { name: "Страница аниме", level: 1 }),
  ).toBeVisible();
  await page.clock.runFor(35_100);
  await expect(
    page.getByText("Загрузка заняла слишком много времени. Повторите запрос.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Повторить", exact: true }),
  ).toBeEnabled();
});
