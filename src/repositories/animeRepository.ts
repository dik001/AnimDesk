import { invoke } from "@tauri-apps/api/core";
import { getDatabase, type DatabaseProvider } from "../database/client";
import type {
  AnimeTitle,
  AnimeUpsertInput,
  StoredAnime,
} from "../types/storage";
import type { AppResult } from "../types/result";
import { storageResult } from "./repositoryResult";
import { requireText } from "./validation";

interface AnimeRow {
  id: number;
  provider: string;
  providerId: string;
  shikimoriId: string | null;
  malId: number | null;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  coverCachePath: string | null;
  year: number | null;
  format: string | null;
  episodesTotal: number | null;
  communityScore: number | null;
  fetchedAt: string;
  metadataJson?: string | null;
}

interface AnimeTitleRow {
  language: string;
  title: string;
}

interface GenreRow {
  name: string;
}

interface AnimeUpsertResult {
  animeId: number;
}

interface AnimeCommandError {
  code: "validation" | "identityConflict" | "storage";
  message: string;
}

export type AnimeUpsertInvoker = (
  input: AnimeUpsertInput,
) => Promise<AnimeUpsertResult>;

const invokeAnimeUpsert: AnimeUpsertInvoker = (input) =>
  invoke<AnimeUpsertResult>("upsert_anime", { input });

export class AnimeRepository {
  constructor(
    private readonly provideDatabase: DatabaseProvider = getDatabase,
    private readonly invokeUpsert: AnimeUpsertInvoker = invokeAnimeUpsert,
  ) {}

  async upsert(input: AnimeUpsertInput): Promise<AppResult<StoredAnime>> {
    let normalized: AnimeUpsertInput;
    try {
      normalized = normalizeAnimeInput(input);
    } catch (cause) {
      return {
        ok: false,
        error: {
          code: "validation",
          message:
            cause instanceof Error
              ? cause.message
              : "Некорректные идентификаторы аниме.",
          cause,
        },
      };
    }

    try {
      const { animeId } = await this.invokeUpsert(normalized);
      return { ok: true, data: await this.getByIdOrThrow(animeId) };
    } catch (cause) {
      const commandError = parseCommandError(cause);
      return {
        ok: false,
        error: {
          code:
            commandError?.code === "identityConflict"
              ? "identity_conflict"
              : commandError?.code === "validation"
                ? "validation"
                : "storage",
          message:
            commandError?.message ?? "Не удалось сохранить данные аниме.",
          cause,
        },
      };
    }
  }

  find(provider: string, providerId: string) {
    return storageResult("Не удалось загрузить данные аниме.", async () => {
      const database = await this.provideDatabase();
      const rows = await database.select<AnimeRow[]>(
        `${ANIME_SELECT}
         WHERE provider = $1 AND provider_id = $2`,
        [provider, providerId],
      );
      return rows[0] ? this.hydrate(rows[0]) : null;
    });
  }

  findByShikimoriId(shikimoriId: string) {
    return storageResult("Не удалось загрузить данные аниме.", async () => {
      const database = await this.provideDatabase();
      const rows = await database.select<AnimeRow[]>(
        `${ANIME_SELECT} WHERE shikimori_id = $1`,
        [requireText(shikimoriId, "Shikimori ID")],
      );
      return rows[0] ? this.hydrate(rows[0]) : null;
    });
  }

  findByMalId(malId: number) {
    return storageResult("Не удалось загрузить данные аниме.", async () => {
      assertMalId(malId);
      const database = await this.provideDatabase();
      const rows = await database.select<AnimeRow[]>(
        `${ANIME_SELECT} WHERE mal_id = $1`,
        [malId],
      );
      return rows[0] ? this.hydrate(rows[0]) : null;
    });
  }

  getById(id: number) {
    return storageResult("Не удалось загрузить данные аниме.", () =>
      this.getByIdOrThrow(id),
    );
  }

  searchLocal(query: string, limit = 50) {
    return storageResult("Не удалось выполнить локальный поиск.", async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new Error("Некорректный лимит локального поиска.");
      }

      const database = await this.provideDatabase();
      const pattern = `%${escapeLike(query.trim())}%`;
      const rows = await database.select<AnimeRow[]>(
        `${ANIME_SELECT}
         WHERE title LIKE $1 ESCAPE '\\'
            OR EXISTS (
              SELECT 1 FROM anime_titles
              WHERE anime_titles.anime_id = anime.id
                AND anime_titles.title LIKE $1 ESCAPE '\\'
            )
         ORDER BY title COLLATE NOCASE
         LIMIT $2`,
        [pattern, limit],
      );
      return Promise.all(rows.map((row) => this.hydrate(row)));
    });
  }

  private async getByIdOrThrow(id: number): Promise<StoredAnime> {
    const database = await this.provideDatabase();
    const rows = await database.select<AnimeRow[]>(
      `${ANIME_SELECT} WHERE id = $1`,
      [id],
    );
    const anime = rows[0];
    if (!anime) {
      throw new Error("Аниме не найдено в локальной базе.");
    }
    return this.hydrate(anime);
  }

  private async hydrate(row: AnimeRow): Promise<StoredAnime> {
    const database = await this.provideDatabase();
    const [titles, genres] = await Promise.all([
      database.select<AnimeTitleRow[]>(
        `SELECT language, title FROM anime_titles
         WHERE anime_id = $1 ORDER BY language, title COLLATE NOCASE`,
        [row.id],
      ),
      database.select<GenreRow[]>(
        `SELECT genres.name
         FROM genres
         JOIN anime_genres ON anime_genres.genre_id = genres.id
         WHERE anime_genres.anime_id = $1
         ORDER BY genres.name COLLATE NOCASE`,
        [row.id],
      ),
    ]);

    return { ...row, titles, genres: genres.map((genre) => genre.name) };
  }
}

const ANIME_SELECT = `SELECT id, provider, provider_id AS providerId,
  shikimori_id AS shikimoriId, mal_id AS malId, title,
  synopsis, cover_url AS coverUrl, cover_cache_path AS coverCachePath,
  year, format, episodes_total AS episodesTotal,
  community_score AS communityScore, fetched_at AS fetchedAt, metadata_json AS metadataJson
  FROM anime`;

function normalizeAnimeInput(input: AnimeUpsertInput): AnimeUpsertInput {
  if (
    input.episodesTotal !== null &&
    (!Number.isSafeInteger(input.episodesTotal) || input.episodesTotal < 0)
  ) {
    throw new Error("Число серий должно быть целым неотрицательным числом.");
  }

  if (input.malId !== null) {
    assertMalId(input.malId);
  }

  return {
    ...input,
    provider: requireText(input.provider, "Источник"),
    providerId: requireText(input.providerId, "Внешний ID"),
    shikimoriId:
      input.shikimoriId === null
        ? null
        : requireText(input.shikimoriId, "Shikimori ID"),
    title: requireText(input.title, "Название"),
    titles: input.titles.map((title: AnimeTitle) => ({
      language: requireText(title.language, "Язык названия"),
      title: requireText(title.title, "Альтернативное название"),
    })),
    genres: input.genres.map((genre) => requireText(genre, "Жанр")),
  };
}

function assertMalId(malId: number): void {
  if (!Number.isSafeInteger(malId) || malId <= 0) {
    throw new Error("MAL ID должен быть положительным целым числом.");
  }
}

function parseCommandError(error: unknown): AnimeCommandError | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    ["validation", "identityConflict", "storage"].includes(error.code)
  ) {
    return error as AnimeCommandError;
  }
  return null;
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export const animeRepository = new AnimeRepository();
