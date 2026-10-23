import { expect, test } from "@playwright/test";

test("навигация, состояния и границы окна", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/home-${testInfo.project.name}.png`,
  });

  for (const [label, heading] of [
    ["Поиск", "Поиск аниме"],
    ["Моя библиотека", "Моя библиотека"],
    ["Профиль", "Профиль"],
    ["Настройки", "Настройки"],
    ["Главная", "Главная"],
  ] as const) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.querySelector("main")!.scrollWidth <=
          document.querySelector("main")!.clientWidth,
      ),
    ).toBe(true);
  }

  await page.getByRole("link", { name: "Поиск", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Название аниме" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Найти", exact: true }),
  ).toBeEnabled();

  await page.getByRole("link", { name: "Моя библиотека", exact: true }).click();
  await page.getByRole("button", { name: /^В планах/ }).click();
  await expect(page.getByRole("button", { name: /^В планах/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("link", { name: "Настройки", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Экспортировать библиотеку",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Импортировать библиотеку", exact: true }),
  ).toBeEnabled();

  await page.goto("/#/anime/source/123");
  await expect(
    page.getByRole("heading", { name: "Страница аниме", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Некорректный источник или ID аниме.", { exact: true }),
  ).toBeVisible();

  await page.goto("/#/missing");
  await expect(
    page.getByRole("heading", { name: "404 — страница не найдена" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "На главную" }).click();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "К содержимому" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(errors).toEqual([]);
});
