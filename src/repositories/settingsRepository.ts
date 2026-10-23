import { getDatabase, type DatabaseProvider } from "../database/client";
import { storageResult } from "./repositoryResult";
import { requireText } from "./validation";

interface SettingRow {
  key: string;
  value: string;
}

export class SettingsRepository {
  constructor(private readonly provideDatabase: DatabaseProvider = getDatabase) {}

  get(key: string) {
    return storageResult("Не удалось загрузить настройку.", async () => {
      const database = await this.provideDatabase();
      const rows = await database.select<SettingRow[]>(
        "SELECT key, value FROM app_settings WHERE key = $1",
        [requireText(key, "Ключ настройки")],
      );
      return rows[0]?.value ?? null;
    });
  }

  list() {
    return storageResult("Не удалось загрузить настройки.", async () => {
      const database = await this.provideDatabase();
      const rows = await database.select<SettingRow[]>(
        "SELECT key, value FROM app_settings ORDER BY key",
      );
      return Object.fromEntries(rows.map(({ key, value }) => [key, value]));
    });
  }

  set(key: string, value: string) {
    return storageResult("Не удалось сохранить настройку.", async () => {
      const database = await this.provideDatabase();
      await database.execute(
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [requireText(key, "Ключ настройки"), value],
      );
    });
  }

  remove(key: string) {
    return storageResult("Не удалось удалить настройку.", async () => {
      const database = await this.provideDatabase();
      await database.execute("DELETE FROM app_settings WHERE key = $1", [
        requireText(key, "Ключ настройки"),
      ]);
    });
  }
}

export const settingsRepository = new SettingsRepository();
