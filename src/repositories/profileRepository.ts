import { getDatabase, type DatabaseProvider } from "../database/client";
import { LOCAL_PROFILE_ID, type Profile } from "../types/storage";
import { storageResult } from "./repositoryResult";
import { requireText } from "./validation";

interface ProfileRow {
  id: string;
  displayName: string;
  avatarPath: string | null;
  createdAt: string;
}

export class ProfileRepository {
  constructor(private readonly provideDatabase: DatabaseProvider = getDatabase) {}

  ensureDefault() {
    return storageResult("Не удалось создать локальный профиль.", async () => {
      const database = await this.provideDatabase();
      const now = new Date().toISOString();
      await database.execute(
        `INSERT INTO profiles (id, display_name, avatar_path, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(id) DO NOTHING`,
        [LOCAL_PROFILE_ID, "Пользователь", null, now],
      );

      const profile = await this.getByIdOrThrow(LOCAL_PROFILE_ID);
      return profile;
    });
  }

  getDefault() {
    return storageResult("Не удалось загрузить локальный профиль.", () =>
      this.getByIdOrThrow(LOCAL_PROFILE_ID),
    );
  }

  updateDisplayName(displayName: string) {
    return storageResult("Не удалось изменить имя профиля.", async () => {
      const database = await this.provideDatabase();
      const result = await database.execute(
        "UPDATE profiles SET display_name = $1 WHERE id = $2",
        [requireText(displayName, "Имя"), LOCAL_PROFILE_ID],
      );
      if (result.rowsAffected !== 1) {
        throw new Error("Локальный профиль не найден.");
      }
      return this.getByIdOrThrow(LOCAL_PROFILE_ID);
    });
  }

  updateAvatarPath(avatarPath: string | null) {
    return storageResult("Не удалось изменить аватар профиля.", async () => {
      const database = await this.provideDatabase();
      const result = await database.execute(
        "UPDATE profiles SET avatar_path = $1 WHERE id = $2",
        [avatarPath, LOCAL_PROFILE_ID],
      );
      if (result.rowsAffected !== 1) {
        throw new Error("Локальный профиль не найден.");
      }
      return this.getByIdOrThrow(LOCAL_PROFILE_ID);
    });
  }

  private async getByIdOrThrow(id: string): Promise<Profile> {
    const database = await this.provideDatabase();
    const rows = await database.select<ProfileRow[]>(
      `SELECT id, display_name AS displayName, avatar_path AS avatarPath,
              created_at AS createdAt
       FROM profiles WHERE id = $1`,
      [id],
    );
    const profile = rows[0];
    if (!profile) {
      throw new Error("Локальный профиль не найден.");
    }
    return profile;
  }
}

export const profileRepository = new ProfileRepository();
