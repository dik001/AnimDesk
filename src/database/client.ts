import Database, { type QueryResult } from "@tauri-apps/plugin-sql";

export const DATABASE_URL = "sqlite:anidesk.db";

export interface DatabaseClient {
  execute(query: string, bindValues?: unknown[]): Promise<QueryResult>;
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

export type DatabaseProvider = () => Promise<DatabaseClient>;

let databasePromise: Promise<DatabaseClient> | undefined;

export function getDatabase(): Promise<DatabaseClient> {
  databasePromise ??= Database.load(DATABASE_URL);
  return databasePromise;
}

export function resetDatabaseForTests(): void {
  databasePromise = undefined;
}
