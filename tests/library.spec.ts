import { expect, test, type Page } from "@playwright/test";
import { desktop } from "./helpers/desktop";

async function add(page: Page) {
  await page.goto("/#/anime/shikimori/100");
  await page
    .getByRole("button", { name: "Добавить в список", exact: true })
    .click();
  const editor = page.getByRole("region", {
    name: "Библиотека: Тестовый сезон",
  });
  await expect(editor).toBeVisible();
  await expect(
    editor.getByRole("combobox", { name: "Изменить статус" }),
  ).toHaveValue("watching");
  return editor;
}

test("список: автодобавление в Смотрю, автосохранение 7/12, заметки, статусы и офлайн", async ({
  page,
}) => {
  const { db, setOffline } = await desktop(page);
  try {
    await page.goto("/#/library");
    await expect(page.getByText("Здесь пока нет аниме")).toBeVisible();
    const editor = await add(page);
    const progress = editor.getByRole("spinbutton");
    await progress.fill("7");
    await progress.press("Enter");
    await expect
      .poll(
        () =>
          db.prepare("SELECT watched_episodes AS n FROM library_entries").get()
            ?.n,
      )
      .toBe(7);
    const notes = editor.getByRole("textbox", { name: "Заметки" });
    await notes.fill("Продолжить вечером");
    await notes.press("Tab");
    await expect
      .poll(() => db.prepare("SELECT notes FROM library_entries").get()?.notes)
      .toBe("Продолжить вечером");
    for (const status of [
      "planned",
      "completed",
      "on_hold",
      "dropped",
      "watching",
    ]) {
      await editor.getByRole("combobox").selectOption(status);
      await expect(editor.getByRole("combobox")).toHaveValue(status);
      await expect(progress).toHaveValue(status === "planned" ? "7" : "12");
    }
    await expect(page.getByText("Сохранено", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Сохранить прогресс", exact: true }),
    ).toHaveCount(0);
    setOffline();
    await page.reload();
    await expect(progress).toHaveValue("12");
    await expect(notes).toHaveValue("Продолжить вечером");
    await page.goto("/#/anime/jikan/1535");
    await expect(progress).toHaveValue("12");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM library_entries").get(),
    ).toMatchObject({ n: 1 });
  } finally {
    db.close();
  }
});

test("библиотека строками: поиск, фильтры, окно через многоточие, сохранение и подтверждение удаления", async ({
  page,
}, info) => {
  const { db } = await desktop(page);
  try {
    await add(page);
    await page
      .getByRole("link", { name: "Моя библиотека", exact: true })
      .click();
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Изменить статус" }),
    ).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Поиск в библиотеке" })
      .fill("ALTERNATIVE");
    await expect(
      page.getByRole("link", { name: "Тестовый сезон", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "В планах (0)", exact: true })
      .click();
    await expect(page.getByText("Нет подходящих записей")).toBeVisible();
    await page.getByRole("button", { name: "Смотрю (1)", exact: true }).click();
    const actions = page.getByLabel("Действия: Тестовый сезон", {
      exact: true,
    });
    await actions.click();
    await page
      .getByRole("button", { name: "Редактировать", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Редактирование аниме" });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Оценить аниме", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Оценить на 5 из 10", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Ваша оценка: 5", exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Ваша оценка: 5", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Ваша оценка: 5", exact: true }),
    ).toBeFocused();
    await dialog.getByRole("spinbutton").fill("7");
    await dialog
      .getByRole("textbox", { name: "Заметки" })
      .fill("Запись из окна");
    await dialog
      .getByRole("combobox", { name: "Список", exact: true })
      .selectOption("on_hold");
    await page.screenshot({
      path: `docs/screenshots/library-edit-${info.project.name}.png`,
    });
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Отложено (1)", exact: true })
      .click();
    await expect(
      page.getByText("Отложено · 7 / 12 серий", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/library-rows-${info.project.name}.png`,
    });
    expect(
      await page
        .locator("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await actions.click();
    await page
      .getByRole("button", { name: "Убрать из списка", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Убрать из списка?" });
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(
      page.getByText("Отложено · 7 / 12 серий", { exact: true }),
    ).toBeVisible();
    await actions.click();
    await page
      .getByRole("button", { name: "Убрать из списка", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Подтвердить удаление" }).click();
    await expect(page.getByText("Здесь пока нет аниме")).toBeVisible();
    expect(db.prepare("SELECT count(*) AS n FROM anime").get()).toMatchObject({
      n: 1,
    });
  } finally {
    db.close();
  }
});

test("автопрогресс: 0/максимум/null, предложение completed и ошибка записи без тостов", async ({
  page,
}) => {
  const { db, failWrites } = await desktop(page);
  try {
    const editor = await add(page);
    const input = editor.getByRole("spinbutton");
    await input.fill("12");
    await input.press("Tab");
    await expect(
      editor.getByRole("button", { name: "Отметить как просмотренное" }),
    ).toBeVisible();
    await expect(editor.getByRole("combobox")).toHaveValue("watching");
    await expect(
      editor.getByRole("button", { name: "Увеличить прогресс" }),
    ).toBeDisabled();
    await editor
      .getByRole("button", { name: "Отметить как просмотренное" })
      .click();
    await expect(editor.getByRole("combobox")).toHaveValue("completed");
    await input.fill("0");
    await input.press("Enter");
    await expect(
      editor.getByRole("button", { name: "Уменьшить прогресс" }),
    ).toBeDisabled();
    await page.goto("/#/anime/shikimori/200");
    await page
      .getByRole("button", { name: "Добавить в список", exact: true })
      .click();
    const other = page.getByRole("region", {
      name: "Библиотека: Другой сезон",
    });
    await other.getByRole("spinbutton").fill("500");
    await other.getByRole("spinbutton").press("Enter");
    await expect
      .poll(
        () =>
          db
            .prepare(
              "SELECT watched_episodes AS n FROM library_entries JOIN anime ON anime.id=anime_id WHERE provider_id='200'",
            )
            .get()?.n,
      )
      .toBe(500);
    failWrites();
    await other.getByRole("button", { name: "Увеличить прогресс" }).click();
    await expect(other.getByRole("alert")).toBeVisible();
    expect(
      db
        .prepare(
          "SELECT watched_episodes AS n FROM library_entries JOIN anime ON anime.id=anime_id WHERE provider_id='200'",
        )
        .get(),
    ).toMatchObject({ n: 500 });
    await expect(page.getByText("Сохранено", { exact: true })).toHaveCount(0);
  } finally {
    db.close();
  }
});

test("резерв Jikan сохраняет тот же anime.id, личную оценку и 7/12", async ({
  page,
}) => {
  const { db, useReserve } = await desktop(page);
  try {
    const editor = await add(page);
    await editor.getByRole("spinbutton").fill("7");
    await editor.getByRole("spinbutton").press("Enter");
    await expect
      .poll(
        () =>
          db.prepare("SELECT watched_episodes AS n FROM library_entries").get()
            ?.n,
      )
      .toBe(7);
    await page
      .getByRole("button", { name: "Оценить аниме", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Оценить на 8 из 10", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ваша оценка: 8", exact: true }),
    ).toBeVisible();
    useReserve();
    await page.goto("/#/anime/jikan/1535");
    await expect(
      page.getByRole("heading", { name: "Тестовый сезон", level: 1 }),
    ).toBeVisible();
    await expect(editor.getByRole("spinbutton")).toHaveValue("7");
    await expect(
      page.getByRole("button", { name: "Ваша оценка: 8", exact: true }),
    ).toBeVisible();
    expect(db.prepare("SELECT count(*) AS n FROM anime").get()).toMatchObject({
      n: 1,
    });
    expect(
      db.prepare("SELECT count(*) AS n FROM library_entries").get(),
    ).toMatchObject({ n: 1 });
    expect(
      db.prepare("SELECT count(*) AS n FROM anime_ratings").get(),
    ).toMatchObject({ n: 1 });
  } finally {
    db.close();
  }
});

test("личные звёзды до добавления, сохранение после перезапуска, онгоинг и связанные сезоны", async ({
  page,
}, info) => {
  const { db, setOffline } = await desktop(page);
  try {
    await page.goto("/#/anime/shikimori/100");
    const trigger = page.getByRole("button", {
      name: "Оценить аниме",
      exact: true,
    });
    await expect(trigger).toBeVisible();
    const title = page.getByRole("heading", {
      name: "Тестовый сезон",
      level: 1,
    });
    expect((await trigger.boundingBox())!.y).toBeLessThan(
      (await title.boundingBox())!.y,
    );
    await expect(
      page.locator("dt").filter({ hasText: "Источник" }),
    ).toHaveCount(0);
    await expect(page.getByText("Онгоинг", { exact: true })).toHaveCSS(
      "color",
      "rgb(177, 215, 160)",
    );
    const related = page.getByRole("region", { name: "Связанное" });
    await expect(related.getByText("ТВ-сериал / 2025")).toBeVisible();
    await trigger.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("button", { name: "Оценить на 1 из 10", exact: true }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Оценить на 9 из 10", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ваша оценка: 9", exact: true }),
    ).toBeVisible();
    expect(
      db.prepare("SELECT count(*) AS n FROM library_entries").get(),
    ).toMatchObject({ n: 0 });
    expect(db.prepare("SELECT community_score FROM anime").get()).toMatchObject(
      { community_score: 8.6 },
    );
    setOffline();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Ваша оценка: 9", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Ваша оценка: 9", exact: true })
      .hover();
    await expect(page.locator(".rating-star").last()).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: `docs/screenshots/personal-rating-${info.project.name}.png`,
    });
    expect(
      await page
        .locator("main")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Снять оценку", exact: true })
      .click();
    await expect(trigger).toBeVisible();
  } finally {
    db.close();
  }
});

test("звёзды: ошибка SQLite остаётся видимой, сохранённая оценка не меняется", async ({
  page,
}) => {
  const { db, failWrites } = await desktop(page);
  try {
    await page.goto("/#/anime/shikimori/100");
    await page
      .getByRole("button", { name: "Оценить аниме", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Оценить на 6 из 10", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Ваша оценка: 6", exact: true }),
    ).toBeVisible();
    failWrites();
    await page
      .getByRole("button", { name: "Ваша оценка: 6", exact: true })
      .hover();
    await page
      .getByRole("button", { name: "Оценить на 10 из 10", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Не удалось сохранить вашу оценку",
    );
    expect(db.prepare("SELECT rating FROM anime_ratings").get()).toMatchObject({
      rating: 6,
    });
    await expect(page.getByText("Сохранено", { exact: true })).toHaveCount(0);
  } finally {
    db.close();
  }
});

test("Просмотрено заполняет все серии в карточке и окне библиотеки; отмена и отказ сохраняют старые данные", async ({
  page,
}) => {
  const { db, failWrites, setOffline } = await desktop(page);
  try {
    const editor = await add(page);
    await editor.getByRole("spinbutton").fill("3");
    await editor.getByRole("spinbutton").press("Enter");
    await expect(editor.getByRole("spinbutton")).toHaveValue("3");
    await editor.getByRole("combobox").selectOption("completed");
    await expect(editor.getByRole("combobox")).toHaveValue("completed");
    await expect(editor.getByRole("spinbutton")).toHaveValue("12");
    await page.getByRole("link", { name: "Профиль", exact: true }).click();
    await expect(page.getByRole("definition").nth(1)).toHaveText("12");
    await page
      .getByRole("link", { name: "Моя библиотека", exact: true })
      .click();
    const open = async () => {
      await page.locator(".library-actions summary").click();
      await page
        .getByRole("button", { name: "Редактировать", exact: true })
        .click();
      return page.getByRole("dialog", { name: "Редактирование аниме" });
    };
    let dialog = await open();
    await dialog.getByRole("combobox").selectOption("watching");
    await dialog.getByRole("spinbutton").fill("3");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await dialog.getByRole("combobox").selectOption("completed");
    await expect(dialog.getByRole("spinbutton")).toHaveValue("12");
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    expect(
      db.prepare("SELECT status,watched_episodes FROM library_entries").get(),
    ).toMatchObject({ status: "watching", watched_episodes: 3 });
    dialog = await open();
    await dialog.getByRole("combobox").selectOption("completed");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    setOffline();
    await page.reload();
    await expect(
      page.getByText("Просмотрено · 12 / 12 серий", { exact: true }),
    ).toBeVisible();
    dialog = await open();
    await dialog.getByRole("combobox").selectOption("on_hold");
    await dialog.getByRole("spinbutton").fill("3");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    failWrites();
    dialog = await open();
    await dialog.getByRole("combobox").selectOption("completed");
    await dialog
      .getByRole("button", { name: "Сохранить", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    expect(
      db.prepare("SELECT status,watched_episodes FROM library_entries").get(),
    ).toMatchObject({ status: "on_hold", watched_episodes: 3 });
  } finally {
    db.close();
  }
});
