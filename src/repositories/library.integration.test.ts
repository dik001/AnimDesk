/* eslint @typescript-eslint/require-await: "off" -- SQLite adapter implements the asynchronous repository contract. */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DatabaseClient } from "../database/client";
import { AnimeRepository } from "./animeRepository";
import { RatingRepository } from "./ratingRepository";
import { LibraryRepository } from "./libraryRepository";
import { LIBRARY_STATUSES } from "../types/anime";
import { filterLibrary } from "../features/library/filterLibrary";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
});
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "animdesk-library-"));
  let db = new DatabaseSync(join(dir, "test.db"));
  cleanups.push(() => {
    db.close();
    rmSync(join(dir, "test.db"));
    rmdirSync(dir);
  });
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of [
    "001_initial",
    "002_external_ids",
    "003_detail_metadata",
    "004_personal_ratings",
  ])
    db.exec(readFileSync(`src-tauri/migrations/${name}.sql`, "utf8"));
  db.exec(`INSERT INTO anime(id,provider,provider_id,shikimori_id,mal_id,title,episodes_total,year,fetched_at) VALUES
    (1,'shikimori','100','100',1535,'Русский сезон',12,2020,'now'),
    (2,'shikimori','200','200',200,'Другой сезон',NULL,2021,'now');
    INSERT INTO anime_titles VALUES(1,'en','Alternative name');`);
  const client: DatabaseClient = {
    async select<T>(sql: string, values: unknown[] = []) {
      const params = Object.fromEntries(
        values.map((value, i) => [`$${i + 1}`, value as SQLInputValue]),
      );
      return db.prepare(sql).all(params) as T;
    },
    async execute(sql: string, values: unknown[] = []) {
      const params = Object.fromEntries(
        values.map((value, i) => [`$${i + 1}`, value as SQLInputValue]),
      );
      const result = db.prepare(sql).run(params);
      return {
        rowsAffected: Number(result.changes),
        lastInsertId: Number(result.lastInsertRowid),
      };
    },
  };
  const anime = new AnimeRepository(async () => client);
  const library = new LibraryRepository(async () => client, anime);
  return {
    library,
    client,
    anime,
    ratings: new RatingRepository(async () => client),
    reopen: () => {
      db.close();
      db = new DatabaseSync(join(dir, "test.db"));
      db.exec("PRAGMA foreign_keys=ON");
    },
  };
}
async function unwrap<T>(
  result: Promise<import("../types/result").AppResult<T>>,
) {
  const value = await result;
  if (!value.ok)
    throw value.error.cause instanceof Error
      ? value.error.cause
      : new Error(value.error.message);
  return value.data;
}
describe("настоящая SQLite и репозитории библиотеки", () => {
  it("пустая библиотека без фиктивных записей", async () => {
    const { library } = setup();
    expect(await unwrap(library.list("local-default"))).toEqual([]);
  });
  it("повторное добавление оставляет одну запись, статус, заметки и 7/12 после рестарта", async () => {
    const { library, reopen } = setup();
    await unwrap(
      library.add({
        profileId: "local-default",
        animeId: 1,
        status: "watching",
      }),
    );
    await unwrap(library.updateProgress("local-default", 1, 7));
    await unwrap(library.updateNotes("local-default", 1, "Заметка"));
    await unwrap(
      library.add({
        profileId: "local-default",
        animeId: 1,
        status: "planned",
      }),
    );
    reopen();
    const entries = await unwrap(library.list("local-default"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      status: "watching",
      watchedEpisodes: 7,
      notes: "Заметка",
      anime: { episodesTotal: 12 },
    });
  });
  it.each(LIBRARY_STATUSES)(
    "статус %s заполняет серии только для completed",
    async (status) => {
      const { library } = setup();
      await unwrap(
        library.add({
          profileId: "local-default",
          animeId: 1,
          status: "planned",
          watchedEpisodes: 7,
        }),
      );
      const entry = await unwrap(
        library.updateStatus("local-default", 1, status),
      );
      expect(entry).toMatchObject({
        status,
        watchedEpisodes: status === "completed" ? 12 : 7,
      });
      expect(await unwrap(library.list("local-default", status))).toHaveLength(
        1,
      );
    },
  );
  it("границы 0/12/null и ошибки не меняют сохранённое значение", async () => {
    const { library } = setup();
    for (const animeId of [1, 2])
      await unwrap(
        library.add({
          profileId: "local-default",
          animeId,
          status: "watching",
        }),
      );
    expect(
      await unwrap(library.updateProgress("local-default", 1, 12)),
    ).toMatchObject({ watchedEpisodes: 12, status: "watching" });
    expect((await library.updateProgress("local-default", 1, 13)).ok).toBe(
      false,
    );
    expect((await library.updateProgress("local-default", 1, -1)).ok).toBe(
      false,
    );
    expect((await library.updateProgress("local-default", 1, 1.5)).ok).toBe(
      false,
    );
    expect(
      await unwrap(library.getByAnimeId("local-default", 1)),
    ).toMatchObject({ watchedEpisodes: 12 });
    expect(
      await unwrap(library.updateProgress("local-default", 1, 0)),
    ).toMatchObject({ watchedEpisodes: 0 });
    expect(
      await unwrap(library.updateProgress("local-default", 2, 500)),
    ).toMatchObject({ watchedEpisodes: 500 });
  });
  it("удаляет только запись библиотеки; оба аниме и соседняя запись остаются", async () => {
    const { library, anime } = setup();
    for (const animeId of [1, 2])
      await unwrap(
        library.add({ profileId: "local-default", animeId, status: "planned" }),
      );
    await unwrap(library.remove("local-default", 1));
    expect(await unwrap(library.list("local-default"))).toHaveLength(1);
    expect(await unwrap(anime.getById(1))).toMatchObject({ id: 1 });
    expect(await unwrap(anime.getById(2))).toMatchObject({ id: 2 });
  });
  it("ищет кириллицу и альтернативные названия; сортирует без изменения исходного массива", async () => {
    const { library } = setup();
    for (const animeId of [1, 2])
      await unwrap(
        library.add({ profileId: "local-default", animeId, status: "planned" }),
      );
    const items = await unwrap(library.list("local-default"));
    expect(
      filterLibrary(items, "all", "РУССКИЙ", "title").map((e) => e.anime.id),
    ).toEqual([1]);
    expect(
      filterLibrary(items, "planned", "alternative", "added").map(
        (e) => e.anime.id,
      ),
    ).toEqual([1]);
    expect(filterLibrary(items, "watching", "", "updated")).toEqual([]);
    expect(
      filterLibrary(items, "all", "", "year").map((e) => e.anime.id),
    ).toEqual([2, 1]);
  });
});

describe("личные оценки в SQLite", () => {
  it("оценка не требует библиотеки, сохраняется после рестарта и не меняет каталог", async () => {
    const { ratings, anime, library, reopen } = setup();
    expect(await unwrap(ratings.get("local-default", 1))).toBeNull();
    await unwrap(ratings.set("local-default", 1, 8));
    reopen();
    expect(await unwrap(ratings.get("local-default", 1))).toBe(8);
    expect(await unwrap(library.list("local-default"))).toEqual([]);
    expect((await unwrap(anime.getById(1))).communityScore).toBeNull();
  });
  it.each([0, 11, -1, 2.5, NaN])(
    "невалидная оценка %s не стирает сохранённую",
    async (rating) => {
      const { ratings } = setup();
      await unwrap(ratings.set("local-default", 1, 7));
      expect((await ratings.set("local-default", 1, rating)).ok).toBe(false);
      expect(await unwrap(ratings.get("local-default", 1))).toBe(7);
    },
  );
  it("границы 1/10, обновление без дубля, удаление из списка и снятие оценки", async () => {
    const { ratings, library } = setup();
    await unwrap(ratings.set("local-default", 1, 1));
    expect(await unwrap(ratings.get("local-default", 1))).toBe(1);
    await unwrap(ratings.set("local-default", 1, 10));
    await unwrap(
      library.add({
        profileId: "local-default",
        animeId: 1,
        status: "watching",
        watchedEpisodes: 7,
      }),
    );
    await unwrap(library.remove("local-default", 1));
    expect(await unwrap(ratings.get("local-default", 1))).toBe(10);
    await unwrap(ratings.set("local-default", 1, null));
    expect(await unwrap(ratings.get("local-default", 1))).toBeNull();
  });
});

it("статистика: пустой список, все статусы, ручные серии, обновление и изоляция профиля", async () => {
  const { library } = setup();
  expect(await unwrap(library.getStatistics("local-default"))).toEqual({
    totalEntries: 0,
    totalWatchedEpisodes: 0,
    byStatus: { watching: 0, planned: 0, completed: 0, on_hold: 0, dropped: 0 },
  });
  await unwrap(
    library.add({
      profileId: "local-default",
      animeId: 1,
      status: "watching",
      watchedEpisodes: 7,
    }),
  );
  await unwrap(
    library.add({
      profileId: "local-default",
      animeId: 2,
      status: "completed",
      watchedEpisodes: 42,
    }),
  );
  expect(await unwrap(library.getStatistics("local-default"))).toEqual({
    totalEntries: 2,
    totalWatchedEpisodes: 49,
    byStatus: { watching: 1, planned: 0, completed: 1, on_hold: 0, dropped: 0 },
  });
  let expectedEpisodes = 49;
  for (const status of LIBRARY_STATUSES) {
    if (status === "completed") expectedEpisodes = 54;
    await unwrap(library.updateStatus("local-default", 1, status));
    const stats = await unwrap(library.getStatistics("local-default"));
    expect(stats.byStatus[status]).toBe(status === "completed" ? 2 : 1);
    expect(stats.totalWatchedEpisodes).toBe(expectedEpisodes);
    expect(stats.totalEntries).toBe(2);
  }
  await unwrap(library.updateProgress("local-default", 1, 8));
  expect(
    (await unwrap(library.getStatistics("local-default"))).totalWatchedEpisodes,
  ).toBe(50);
  await unwrap(library.remove("local-default", 2));
  expect(
    (await unwrap(library.getStatistics("local-default"))).totalEntries,
  ).toBe(1);
  expect(
    (await unwrap(library.getStatistics("other-profile"))).totalEntries,
  ).toBe(0);
});

it.each(["add", "status", "edit"] as const)(
  "completed через %s: известный total заполняется, неизвестный сохраняет прогресс",
  async (operation) => {
    const { library, reopen } = setup();
    for (const animeId of [1, 2]) {
      if (operation === "add")
        await unwrap(
          library.add({
            profileId: "local-default",
            animeId,
            status: "completed",
            watchedEpisodes: 3,
          }),
        );
      else {
        await unwrap(
          library.add({
            profileId: "local-default",
            animeId,
            status: "watching",
            watchedEpisodes: 3,
            notes: "Заметка",
          }),
        );
        if (operation === "status")
          await unwrap(
            library.updateStatus("local-default", animeId, "completed"),
          );
        else
          await unwrap(
            library.update("local-default", animeId, {
              status: "completed",
              watchedEpisodes: 3,
              notes: "Заметка",
              startedAt: null,
              completedAt: null,
            }),
          );
      }
    }
    reopen();
    const entries = await unwrap(library.list("local-default"));
    expect(entries.find((e) => e.anime.id === 1)).toMatchObject({
      status: "completed",
      watchedEpisodes: 12,
    });
    expect(entries.find((e) => e.anime.id === 2)).toMatchObject({
      status: "completed",
      watchedEpisodes: 3,
    });
    await unwrap(
      library.add({
        profileId: "local-default",
        animeId: 2,
        status: "completed",
      }),
    );
    expect(
      (await unwrap(library.getByAnimeId("local-default", 2)))?.watchedEpisodes,
    ).toBe(3);
  },
);


it("библиотека из 1000 сезонов: чтение, фильтр, сортировка, статистика и повторное открытие SQLite", async () => {
  const { library, client, reopen } = setup();
  await client.execute(`WITH RECURSIVE numbers(n) AS (
    SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<1000
  ) INSERT INTO anime(id,provider,provider_id,shikimori_id,title,episodes_total,year,fetched_at)
    SELECT 10000+n,'shikimori',CAST(10000+n AS TEXT),CAST(10000+n AS TEXT),
      'Сезон 日本語 ' || printf('%04d',n),12,2000+n%26,'2026-10-24T00:00:00Z'
    FROM numbers`);
  await client.execute(`INSERT INTO library_entries(profile_id,anime_id,status,watched_episodes,notes,added_at,updated_at)
    SELECT 'local-default',id,
      CASE (id-10000)%5 WHEN 0 THEN 'watching' WHEN 1 THEN 'planned'
        WHEN 2 THEN 'completed' WHEN 3 THEN 'on_hold' ELSE 'dropped' END,
      (id-10000)%13,'Заметка ё 日本語','2026-10-24T00:00:00Z','2026-10-24T00:00:00Z'
    FROM anime WHERE id>10000`);
  const entries = await unwrap(library.list("local-default"));
  expect(entries).toHaveLength(1000);
  expect(new Set(entries.map((e) => e.anime.id)).size).toBe(1000);
  const filtered = filterLibrary(entries, "watching", "日本語", "title");
  expect(filtered).toHaveLength(200);
  expect(filtered.map((e) => e.anime.title)).toEqual(
    filtered.map((e) => e.anime.title).sort((a, b) => a.localeCompare(b, "ru")),
  );
  reopen();
  const statistics = await unwrap(library.getStatistics("local-default"));
  expect(statistics.totalEntries).toBe(1000);
  expect(Object.values(statistics.byStatus)).toEqual([200, 200, 200, 200, 200]);
  expect(statistics.totalWatchedEpisodes).toBe(
    Array.from({ length: 1000 }, (_, index) => (index + 1) % 13).reduce((a, b) => a + b, 0),
  );
  expect(await unwrap(library.list("local-default", "on_hold"))).toHaveLength(200);
});
