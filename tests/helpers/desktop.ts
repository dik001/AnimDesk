import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { AnimeUpsertInput } from "../../src/types/storage";
export async function desktop(
  page: Page,
  ipc: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  const db = new DatabaseSync(":memory:");
  for (const name of [
    "001_initial",
    "002_external_ids",
    "003_detail_metadata",
    "004_personal_ratings",
  ])
    db.exec(readFileSync(`src-tauri/migrations/${name}.sql`, "utf8"));
  let offline = false;
  let failWrite = false;
  let reserveOnly = false;
  let hangCatalog = false;
  await page.exposeFunction(
    "testIPC",
    (command: string, args: Record<string, unknown>) => {
      if (ipc[command]) return ipc[command](args);
      if (command === "plugin:path|resolve_directory")
        return "C:\\Users\\Test\\AppData\\Roaming\\app.anidesk.desktop";
      if (command === "plugin:path|join")
        return (args.paths as string[]).join("\\");
      if (command === "plugin:sql|load") return "sqlite:anidesk.db";
      if (command === "plugin:sql|select" || command === "plugin:sql|execute") {
        const query = String(args.query);
        const values = (args.values ?? []) as SQLInputValue[];
        const params = Object.fromEntries(
          values.map((value, i) => [`$${i + 1}`, value]),
        );
        if (command.endsWith("select")) return db.prepare(query).all(params);
        if (
          failWrite &&
          (query.includes("library_entries") || query.includes("anime_ratings"))
        )
          throw new Error("Тестовый отказ записи SQLite");
        const result = db.prepare(query).run(params);
        return [Number(result.changes), Number(result.lastInsertRowid)];
      }
      if (command === "upsert_anime") {
        const a = args.input as AnimeUpsertInput;
        const matches = db
          .prepare(
            "SELECT id FROM anime WHERE (provider=? AND provider_id=?) OR shikimori_id=? OR mal_id=?",
          )
          .all(a.provider, a.providerId, a.shikimoriId, a.malId) as {
          id: number;
        }[];
        if (matches.length > 1) throw new Error("Конфликт внешних ID");
        const id =
          matches[0]?.id ??
          Number(
            db
              .prepare(
                "INSERT INTO anime(provider,provider_id,shikimori_id,mal_id,title,fetched_at) VALUES(?,?,?,?,?,?)",
              )
              .run(
                a.provider,
                a.providerId,
                a.shikimoriId,
                a.malId,
                a.title,
                a.fetchedAt,
              ).lastInsertRowid,
          );
        db.prepare(
          "UPDATE anime SET community_score=?,format=?,cover_url=?,title=?,synopsis=?,episodes_total=?,year=?,metadata_json=?,shikimori_id=COALESCE(?,shikimori_id),mal_id=COALESCE(?,mal_id) WHERE id=?",
        ).run(
          a.communityScore,
          a.format,
          a.coverUrl,
          a.title,
          a.synopsis,
          a.episodesTotal,
          a.year,
          a.metadataJson ?? null,
          a.shikimoriId,
          a.malId,
          id,
        );
        for (const title of a.titles)
          db.prepare("INSERT OR IGNORE INTO anime_titles VALUES(?,?,?)").run(
            id,
            title.language,
            title.title,
          );
        return { animeId: id };
      }
      if (
        command === "warm_covers" ||
        command === "reset_avatar" ||
        command === "cancel_import"
      )
        return null;
      if (command === "avatar_image") return null;
      if (command === "cover_image") return { saved: false, data: null };
      if (command === "catalog_request") {
        if (hangCatalog) return new Promise<unknown>(() => {});
        if (offline) throw new Error("Нет сети");
        const r = args.request as {
          provider: string;
          id?: string;
          operation: string;
        };
        if (reserveOnly && r.provider === "shikimori")
          throw new Error("Shikimori offline");
        const shiki = {
          id: r.id ?? "100",
          malId: r.id === "200" ? "200" : "1535",
          russian: r.id === "200" ? "Другой сезон" : "Тестовый сезон",
          name: "Alternative title",
          episodes: r.id === "200" ? 0 : 12,
          status: "ongoing",
          score: 8.6,
          description: "Описание сезона",
          airedOn: { year: 2020 },
          related: [
            {
              relationKind: "sequel",
              relationText: "Продолжение",
              anime: {
                id: "200",
                russian: "Другой сезон",
                name: "Other season",
                kind: "tv",
                airedOn: { year: 2025 },
              },
            },
          ],
        };
        if (r.operation === "genres")
          return r.provider === "shikimori" ? [] : { data: [] };
        if (r.operation === "top" || r.operation === "season")
          return r.provider === "shikimori"
            ? { data: { animes: [shiki] } }
            : {
                data: [
                  { mal_id: 1535, title: "Alternative title", episodes: 12 },
                ],
                pagination: { has_next_page: false },
              };
        return r.provider === "shikimori"
          ? { data: { animes: [shiki] } }
          : {
              data: { mal_id: 1535, title: "Alternative title", episodes: 12 },
            };
      }
      throw new Error(`Unexpected IPC: ${command}`);
    },
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "isTauri", { value: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: (command: string, args: unknown) =>
          (
            window as unknown as {
              testIPC: (c: string, a: unknown) => Promise<unknown>;
            }
          ).testIPC(command, args),
      },
    });
  });
  return {
    db,
    useReserve: () => {
      reserveOnly = true;
    },
    setOffline: (value = true) => {
      offline = value;
    },
    hangRequests: () => {
      hangCatalog = true;
    },
    failWrites: () => {
      failWrite = true;
    },
  };
}
