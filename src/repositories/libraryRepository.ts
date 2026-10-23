import { libraryChanged } from "../features/library/events";
import { getDatabase, type DatabaseProvider } from "../database/client";
import {
  LIBRARY_STATUSES,
  type LibraryStatus,
  type ProviderAnimeIdentity,
} from "../types/anime";
import type {
  AddLibraryEntryInput,
  LibraryRecord,
  LibraryStatistics,
  UpdateLibraryEntryInput,
} from "../types/storage";
import { animeRepository, type AnimeRepository } from "./animeRepository";
import { storageResult } from "./repositoryResult";
import { assertLibraryStatus, assertProgress } from "./validation";

interface LibraryRow {
  profileId: string;
  animeId: number;
  status: LibraryStatus;
  watchedEpisodes: number;
  notes: string | null;
  addedAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface EpisodeTotalRow {
  episodesTotal: number | null;
}

interface StatisticsStatusRow {
  status: LibraryStatus;
  count: number;
  watched: number;
}

export class LibraryRepository {
  constructor(
    private readonly provideDatabase: DatabaseProvider = getDatabase,
    private readonly anime: AnimeRepository = animeRepository,
  ) {}

  list(profileId: string, status?: LibraryStatus) {
    return storageResult("Не удалось загрузить библиотеку.", async () => {
      const database = await this.provideDatabase();
      if (status !== undefined) {
        assertLibraryStatus(status);
      }
      const rows = await database.select<LibraryRow[]>(
        `${LIBRARY_SELECT}
         WHERE library_entries.profile_id = $1
           AND ($2 IS NULL OR library_entries.status = $2)
         ORDER BY library_entries.updated_at DESC`,
        [profileId, status ?? null],
      );
      return Promise.all(rows.map((row) => this.hydrate(row)));
    });
  }

  find(profileId: string, identity: ProviderAnimeIdentity) {
    return storageResult(
      "Не удалось загрузить элемент библиотеки.",
      async () => {
        const database = await this.provideDatabase();
        const rows = await database.select<LibraryRow[]>(
          `${LIBRARY_SELECT}
         JOIN anime ON anime.id = library_entries.anime_id
         WHERE library_entries.profile_id = $1
           AND anime.provider = $2
           AND anime.provider_id = $3`,
          [profileId, identity.provider, identity.providerId],
        );
        return rows[0] ? this.hydrate(rows[0]) : null;
      },
    );
  }

  add(input: AddLibraryEntryInput) {
    return storageResult(
      "Не удалось добавить аниме в библиотеку.",
      async () => {
        assertLibraryStatus(input.status);
        const watchedEpisodes = input.watchedEpisodes ?? 0;
        await this.validateProgress(input.animeId, watchedEpisodes);
        const database = await this.provideDatabase();
        const now = new Date().toISOString();
        await database.execute(
          `INSERT INTO library_entries (
          profile_id, anime_id, status, watched_episodes, notes,
          added_at, updated_at, started_at, completed_at
        ) VALUES ($1, $2, $3,
          CASE WHEN $3 = 'completed'
            THEN COALESCE((SELECT NULLIF(episodes_total, 0) FROM anime WHERE id = $2), $4)
            ELSE $4 END,
          $5, $6, $6, $7, $8)
        ON CONFLICT(profile_id, anime_id) DO NOTHING`,
          [
            input.profileId,
            input.animeId,
            input.status,
            watchedEpisodes,
            input.notes ?? null,
            now,
            input.startedAt ?? null,
            input.completedAt ?? null,
          ],
        );
        return this.getByKeysOrThrow(input.profileId, input.animeId);
      },
    );
  }

  update(profileId: string, animeId: number, input: UpdateLibraryEntryInput) {
    return storageResult(
      "Не удалось обновить элемент библиотеки.",
      async () => {
        assertLibraryStatus(input.status);
        await this.validateProgress(animeId, input.watchedEpisodes);
        const database = await this.provideDatabase();
        const result = await database.execute(
          `UPDATE library_entries
         SET status = $1,
             watched_episodes = CASE WHEN $1 = 'completed'
               THEN COALESCE((SELECT NULLIF(episodes_total, 0) FROM anime WHERE id = $8), $2)
               ELSE $2 END,
             notes = $3,
             started_at = $4, completed_at = $5, updated_at = $6
         WHERE profile_id = $7 AND anime_id = $8`,
          [
            input.status,
            input.watchedEpisodes,
            input.notes,
            input.startedAt,
            input.completedAt,
            new Date().toISOString(),
            profileId,
            animeId,
          ],
        );
        assertOneChanged(result.rowsAffected);
        return this.getByKeysOrThrow(profileId, animeId);
      },
    );
  }

  updateStatus(profileId: string, animeId: number, status: LibraryStatus) {
    return storageResult("Не удалось изменить статус.", async () => {
      assertLibraryStatus(status);
      const database = await this.provideDatabase();
      const result = await database.execute(
        `UPDATE library_entries
         SET status = $1,
             watched_episodes = CASE WHEN $1 = 'completed'
               THEN COALESCE((SELECT NULLIF(episodes_total, 0) FROM anime WHERE id = $4), watched_episodes)
               ELSE watched_episodes END,
             updated_at = $2
         WHERE profile_id = $3 AND anime_id = $4`,
        [status, new Date().toISOString(), profileId, animeId],
      );
      assertOneChanged(result.rowsAffected);
      return this.getByKeysOrThrow(profileId, animeId);
    });
  }

  updateProgress(profileId: string, animeId: number, watchedEpisodes: number) {
    return storageResult("Не удалось изменить прогресс.", async () => {
      await this.validateProgress(animeId, watchedEpisodes);
      const database = await this.provideDatabase();
      const result = await database.execute(
        `UPDATE library_entries
         SET watched_episodes = $1, updated_at = $2
         WHERE profile_id = $3 AND anime_id = $4`,
        [watchedEpisodes, new Date().toISOString(), profileId, animeId],
      );
      assertOneChanged(result.rowsAffected);
      return this.getByKeysOrThrow(profileId, animeId);
    });
  }

  updateNotes(profileId: string, animeId: number, notes: string | null) {
    return storageResult("Не удалось изменить заметки.", async () => {
      const database = await this.provideDatabase();
      const result = await database.execute(
        `UPDATE library_entries
         SET notes = $1, updated_at = $2
         WHERE profile_id = $3 AND anime_id = $4`,
        [notes, new Date().toISOString(), profileId, animeId],
      );
      assertOneChanged(result.rowsAffected);
      return this.getByKeysOrThrow(profileId, animeId);
    });
  }

  remove(profileId: string, animeId: number) {
    return storageResult(
      "Не удалось удалить аниме из библиотеки.",
      async () => {
        const database = await this.provideDatabase();
        await database.execute(
          "DELETE FROM library_entries WHERE profile_id = $1 AND anime_id = $2",
          [profileId, animeId],
        );
        libraryChanged();
      },
    );
  }

  getStatistics(profileId: string) {
    return storageResult("Не удалось рассчитать статистику.", async () => {
      const database = await this.provideDatabase();
      const statusRows = await database.select<StatisticsStatusRow[]>(
        `SELECT status, COUNT(*) AS count, SUM(watched_episodes) AS watched
           FROM library_entries WHERE profile_id = $1 GROUP BY status`,
        [profileId],
      );
      const byStatus = Object.fromEntries(
        LIBRARY_STATUSES.map((status) => [status, 0]),
      ) as Record<LibraryStatus, number>;
      for (const row of statusRows) {
        assertLibraryStatus(row.status);
        byStatus[row.status] = row.count;
      }

      return {
        totalEntries: statusRows.reduce((sum, row) => sum + row.count, 0),
        totalWatchedEpisodes: statusRows.reduce(
          (sum, row) => sum + row.watched,
          0,
        ),
        byStatus,
      } satisfies LibraryStatistics;
    });
  }

  private async validateProgress(animeId: number, watchedEpisodes: number) {
    const database = await this.provideDatabase();
    const rows = await database.select<EpisodeTotalRow[]>(
      "SELECT episodes_total AS episodesTotal FROM anime WHERE id = $1",
      [animeId],
    );
    const anime = rows[0];
    if (!anime) {
      throw new Error("Аниме не найдено в локальной базе.");
    }
    assertProgress(watchedEpisodes, anime.episodesTotal);
  }

  getByAnimeId(profileId: string, animeId: number) {
    return storageResult(
      "Не удалось загрузить запись библиотеки.",
      async () => {
        const database = await this.provideDatabase();
        const rows = await database.select<LibraryRow[]>(
          `${LIBRARY_SELECT} WHERE profile_id = $1 AND anime_id = $2`,
          [profileId, animeId],
        );
        return rows[0] ? this.hydrate(rows[0]) : null;
      },
    );
  }

  private async getByKeysOrThrow(
    profileId: string,
    animeId: number,
  ): Promise<LibraryRecord> {
    const database = await this.provideDatabase();
    const rows = await database.select<LibraryRow[]>(
      `${LIBRARY_SELECT}
       WHERE library_entries.profile_id = $1
         AND library_entries.anime_id = $2`,
      [profileId, animeId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Элемент библиотеки не найден.");
    }
    const entry = await this.hydrate(row);
    libraryChanged();
    return entry;
  }

  private async hydrate(row: LibraryRow): Promise<LibraryRecord> {
    const anime = await this.anime.getById(row.animeId);
    if (!anime.ok) {
      throw anime.error.cause instanceof Error
        ? anime.error.cause
        : new Error(anime.error.message, { cause: anime.error.cause });
    }
    return { ...row, anime: anime.data };
  }
}

const LIBRARY_SELECT = `SELECT
  library_entries.profile_id AS profileId,
  library_entries.anime_id AS animeId,
  library_entries.status,
  library_entries.watched_episodes AS watchedEpisodes,
  library_entries.notes,
  library_entries.added_at AS addedAt,
  library_entries.updated_at AS updatedAt,
  library_entries.started_at AS startedAt,
  library_entries.completed_at AS completedAt
  FROM library_entries`;

function assertOneChanged(rowsAffected: number): void {
  if (rowsAffected !== 1) {
    throw new Error("Элемент библиотеки не найден.");
  }
}

export const libraryRepository = new LibraryRepository();
