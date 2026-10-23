import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../database/client";
import type { AnimeUpsertInput } from "../types/storage";
import { AnimeRepository } from "./animeRepository";
import { LibraryRepository } from "./libraryRepository";
import { ProfileRepository } from "./profileRepository";
import { assertProgress } from "./validation";

class RecordingDatabase implements DatabaseClient {
  readonly executions: Array<{ query: string; values: unknown[] }> = [];
  readonly selections: Array<{ query: string; values: unknown[] }> = [];
  readonly queuedSelections: unknown[] = [];

  execute(query: string, bindValues: unknown[] = []) {
    this.executions.push({ query, values: bindValues });
    return Promise.resolve({ rowsAffected: 1 });
  }

  select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    this.selections.push({ query, values: bindValues });
    return Promise.resolve(this.queuedSelections.shift() as T);
  }
}

const storedAnimeRow = {
  id: 7,
  provider: "provider",
  providerId: "season-1",
  shikimoriId: "101",
  malId: 202,
  title: "Сезон",
  synopsis: null,
  coverUrl: null,
  coverCachePath: null,
  year: null,
  format: null,
  episodesTotal: 12,
  communityScore: null,
  fetchedAt: "2026-10-23T00:00:00.000Z",
};

const libraryRow = {
  profileId: "local-default",
  animeId: 7,
  status: "planned",
  watchedEpisodes: 5,
  notes: null,
  addedAt: "2026-10-23T00:00:00.000Z",
  updatedAt: "2026-10-23T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
};

const animeUpsertInput: AnimeUpsertInput = {
  provider: "provider",
  providerId: "season-1",
  shikimoriId: "101",
  malId: 202,
  title: "Сезон",
  synopsis: null,
  coverUrl: null,
  coverCachePath: null,
  year: null,
  format: null,
  episodesTotal: null,
  communityScore: null,
  fetchedAt: "2026-10-23T00:00:00.000Z",
  titles: [{ language: "ru", title: "Сезон" }],
  genres: ["Фэнтези"],
};

describe("валидация прогресса", () => {
  it("разрешает любой неотрицательный прогресс при неизвестном числе серий", () => {
    expect(() => assertProgress(500, null)).not.toThrow();
  });

  it("отклоняет отрицательный и превышающий известный максимум прогресс", () => {
    expect(() => assertProgress(-1, null)).toThrow(/неотрицательным/);
    expect(() => assertProgress(13, 12)).toThrow(/не может превышать/);
    expect(() => assertProgress(12, 12)).not.toThrow();
  });
});

describe("репозитории", () => {
  it("создаёт постоянный профиль параметризованным INSERT OR IGNORE", async () => {
    const database = new RecordingDatabase();
    database.queuedSelections.push([
      {
        id: "local-default",
        displayName: "Сохранённое имя",
        avatarPath: null,
        createdAt: "2026-10-23T00:00:00.000Z",
      },
    ]);
    const repository = new ProfileRepository(() => Promise.resolve(database));

    const result = await repository.ensureDefault();

    expect(result.ok).toBe(true);
    expect(database.executions[0]?.query).toContain(
      "ON CONFLICT(id) DO NOTHING",
    );
    expect(database.executions[0]?.query).toContain("$1");
    expect(database.executions[0]?.values.slice(0, 3)).toEqual([
      "local-default",
      "Пользователь",
      null,
    ]);
    if (result.ok) {
      expect(result.data.displayName).toBe("Сохранённое имя");
    }
  });

  it("передаёт составной upsert одной Rust-команде", async () => {
    const database = new RecordingDatabase();
    database.queuedSelections.push([storedAnimeRow], [], []);
    const invokeUpsert = vi.fn(() => Promise.resolve({ animeId: 7 }));
    const repository = new AnimeRepository(
      () => Promise.resolve(database),
      invokeUpsert,
    );
    const result = await repository.upsert(animeUpsertInput);

    expect(result.ok).toBe(true);
    expect(invokeUpsert).toHaveBeenCalledOnce();
    expect(invokeUpsert).toHaveBeenCalledWith(animeUpsertInput);
  });

  it("возвращает отдельную ошибку при конфликте достоверных внешних ID", async () => {
    const database = new RecordingDatabase();
    const conflict = Object.assign(
      new Error("Идентификаторы относятся к разным записям"),
      { code: "identityConflict" },
    );
    const invokeUpsert = vi.fn(() => Promise.reject(conflict));
    const repository = new AnimeRepository(
      () => Promise.resolve(database),
      invokeUpsert,
    );

    const result = await repository.upsert(animeUpsertInput);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "identity_conflict",
        message: "Идентификаторы относятся к разным записям",
      },
    });
  });

  it("проверяет MAL ID до вызова Rust-команды", async () => {
    const database = new RecordingDatabase();
    const invokeUpsert = vi.fn(() => Promise.resolve({ animeId: 7 }));
    const repository = new AnimeRepository(
      () => Promise.resolve(database),
      invokeUpsert,
    );

    const result = await repository.upsert({ ...animeUpsertInput, malId: 0 });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "validation" },
    });
    expect(invokeUpsert).not.toHaveBeenCalled();
  });

  it("ищет локальную запись по отдельным Shikimori и MAL ID", async () => {
    const database = new RecordingDatabase();
    database.queuedSelections.push(
      [storedAnimeRow],
      [],
      [],
      [storedAnimeRow],
      [],
      [],
    );
    const repository = new AnimeRepository(
      () => Promise.resolve(database),
      vi.fn(),
    );

    const byShikimori = await repository.findByShikimoriId("101");
    const byMal = await repository.findByMalId(202);

    expect(byShikimori.ok).toBe(true);
    expect(byMal.ok).toBe(true);
    expect(database.selections[0]?.query).toContain("shikimori_id = $1");
    expect(database.selections[3]?.query).toContain("mal_id = $1");
  });

  it("смена на отложено сохраняет прогресс", async () => {
    const database = new RecordingDatabase();
    database.queuedSelections.push(
      [{ ...libraryRow, status: "on_hold" }],
      [storedAnimeRow],
      [],
      [],
    );
    const anime = new AnimeRepository(() => Promise.resolve(database), vi.fn());
    const repository = new LibraryRepository(
      () => Promise.resolve(database),
      anime,
    );

    const result = await repository.updateStatus("local-default", 7, "on_hold");

    expect(result.ok).toBe(true);
    expect(database.executions[0]?.values[0]).toBe("on_hold");
    if (result.ok) {
      expect(result.data.watchedEpisodes).toBe(5);
      expect(result.data.status).toBe("on_hold");
    }
  });

  it("достижение последней серии не меняет статус автоматически", async () => {
    const database = new RecordingDatabase();
    database.queuedSelections.push(
      [{ episodesTotal: 12 }],
      [{ ...libraryRow, watchedEpisodes: 12 }],
      [storedAnimeRow],
      [],
      [],
    );
    const anime = new AnimeRepository(() => Promise.resolve(database), vi.fn());
    const repository = new LibraryRepository(
      () => Promise.resolve(database),
      anime,
    );

    const result = await repository.updateProgress("local-default", 7, 12);

    expect(result.ok).toBe(true);
    expect(database.executions[0]?.query).not.toContain("status =");
    if (result.ok) {
      expect(result.data.status).toBe("planned");
      expect(result.data.watchedEpisodes).toBe(12);
    }
  });
});
