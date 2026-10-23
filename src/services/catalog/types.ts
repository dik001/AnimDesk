import type { AnimeMetadata } from "../../types/anime";
import type { AnimeTitle } from "../../types/storage";
export type CatalogSource = "shikimori" | "jikan";
export interface CatalogAnime extends AnimeMetadata {
  id: number | null;
  local?: boolean;
  provider: CatalogSource;
  titles: AnimeTitle[];
  genres: string[];
  format: string | null;
  score: number | null;
  status: string | null;
  related: {
    provider: CatalogSource;
    providerId: string;
    title: string;
    relation: string;
    coverUrl?: string | null;
    year?: number | null;
    format?: string | null;
  }[];
}
export interface CatalogFilters {
  year?: number;
  kind?: string;
  genre?: string;
}
export interface CatalogPage {
  items: CatalogAnime[];
  page: number;
  hasNextPage: boolean;
}
export interface CatalogData<T> {
  data: T;
  source: CatalogSource;
  warning?: string;
  cached?: boolean;
}
export interface CatalogGenre {
  id: string;
  name: string;
  label: string;
}
export interface AnimeCatalogProvider {
  getGenres(signal?: AbortSignal): Promise<CatalogGenre[]>;
  searchAnime(
    query: string,
    page: number,
    filters: CatalogFilters,
    signal?: AbortSignal,
  ): Promise<CatalogPage>;
  getAnimeById(
    provider: CatalogSource,
    id: string,
    signal?: AbortSignal,
  ): Promise<CatalogAnime>;
  getTopAnime(signal?: AbortSignal): Promise<CatalogPage>;
  getCurrentSeason(signal?: AbortSignal): Promise<CatalogPage>;
}
export interface CatalogRequest {
  provider: CatalogSource;
  operation: "search" | "detail" | "top" | "season" | "genres";
  query?: string;
  id?: string;
  page?: number;
  year?: number;
  kind?: string;
  season?: string;
  genre?: string;
}
export type CatalogTransport = (
  request: CatalogRequest,
  signal?: AbortSignal,
) => Promise<unknown>;
export class CatalogError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail: unknown = null,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}
export function currentSeason(date = new Date()): string {
  return `${["winter", "spring", "summer", "fall"][Math.floor(date.getMonth() / 3)]}_${date.getFullYear()}`;
}
export function currentSeasonTitle(date = new Date()): string {
  return `Аниме ${["зимнего", "весеннего", "летнего", "осеннего"][Math.floor(date.getMonth() / 3)]} сезона`;
}
export function checkAbort(signal?: AbortSignal) {
  signal?.throwIfAborted();
}
export function catalogError(e: unknown): CatalogError {
  if (e instanceof CatalogError) return e;
  if (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    "message" in e &&
    typeof e.message === "string"
  ) {
    return new CatalogError(
      String(e.code),
      e.message,
      "detail" in e ? e.detail : e,
      "retryAfterSeconds" in e && typeof e.retryAfterSeconds === "number"
        ? e.retryAfterSeconds
        : undefined,
    );
  }
  return new CatalogError(
    "network",
    "Не удалось связаться с каталогом. Проверьте подключение к сети.",
    e,
  );
}
export const sourceLabel = (source: CatalogSource) =>
  source === "shikimori" ? "Shikimori" : "Дополнительный источник";

export function formatLabel(value: string | null): string {
  if (!value) return "Тип неизвестен";
  return (
    (
      {
        tv: "ТВ-сериал",
        movie: "Фильм",
        ova: "OVA",
        ona: "ONA",
        special: "Спецвыпуск",
        tv_special: "ТВ-спецвыпуск",
        music: "Музыкальное видео",
        cm: "Реклама",
        pv: "Проморолик",
      } as Record<string, string>
    )[value] ?? "Другой формат"
  );
}
