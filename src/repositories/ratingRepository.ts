import { getDatabase, type DatabaseProvider } from "../database/client";
import { storageResult } from "./repositoryResult";
import { libraryChanged } from "../features/library/events";

export class RatingRepository {
  constructor(
    private readonly provideDatabase: DatabaseProvider = getDatabase,
  ) {}
  get(profileId: string, animeId: number) {
    return storageResult("Не удалось загрузить вашу оценку.", async () => {
      const db = await this.provideDatabase();
      const rows = await db.select<{ rating: number }[]>(
        "SELECT rating FROM anime_ratings WHERE profile_id = $1 AND anime_id = $2",
        [profileId, animeId],
      );
      return rows[0]?.rating ?? null;
    });
  }
  set(profileId: string, animeId: number, rating: number | null) {
    return storageResult("Не удалось сохранить вашу оценку.", async () => {
      if (
        rating !== null &&
        (!Number.isInteger(rating) || rating < 1 || rating > 10)
      )
        throw new Error("Оценка должна быть целым числом от 1 до 10.");
      const db = await this.provideDatabase();
      if (rating === null)
        await db.execute(
          "DELETE FROM anime_ratings WHERE profile_id = $1 AND anime_id = $2",
          [profileId, animeId],
        );
      else
        await db.execute(
          `INSERT INTO anime_ratings(profile_id, anime_id, rating, updated_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(profile_id, anime_id) DO UPDATE SET rating=excluded.rating, updated_at=excluded.updated_at`,
          [profileId, animeId, rating, new Date().toISOString()],
        );
      libraryChanged();
      return rating;
    });
  }
}
export const ratingRepository = new RatingRepository();
