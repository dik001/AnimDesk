import { catalogStore, type CatalogStore } from "./storage";
export type { CatalogStore } from "./storage";
export { fromStored } from "./storage";
import { fromStored } from "./storage";
import { ShikimoriProvider } from "./providers";
import {
  CatalogError,
  catalogError,
  checkAbort,
  type AnimeCatalogProvider,
  type CatalogAnime,
  type CatalogData,
  type CatalogFilters,
  type CatalogGenre,
  type CatalogPage,
  type CatalogSource,
} from "./types";
export class CatalogService {
  private cache = new Map<
    string,
    { expires: number; value: CatalogData<unknown> }
  >();
  private known = new Map<string, CatalogAnime>();
  constructor(
    private primary: AnimeCatalogProvider = new ShikimoriProvider(),
    private storage: CatalogStore = catalogStore,
  ) {}
  private remember(anime: CatalogAnime) {
    const key = `${anime.provider}:${anime.providerId}`;
    this.known.delete(key);
    this.known.set(key, anime);
    if (this.known.size > 400)
      this.known.delete(this.known.keys().next().value!);
  }
  private cached<T>(key: string): CatalogData<T> | undefined {
    const hit = this.cache.get(key);
    return hit && hit.expires > Date.now()
      ? ({ ...hit.value, cached: true } as CatalogData<T>)
      : undefined;
  }
  private put<T>(key: string, value: CatalogData<T>): CatalogData<T> {
    this.cache.delete(key);
    this.cache.set(key, { expires: Date.now() + 5 * 60_000, value });
    if (this.cache.size > 100)
      this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
  private async list(
    key: string,
    primary: () => Promise<CatalogPage>,
    signal?: AbortSignal,
  ): Promise<CatalogData<CatalogPage>> {
    checkAbort(signal);
    if (typeof navigator !== "undefined" && navigator.onLine === false)
      throw new CatalogError(
        "unavailable",
        "Нет сети. Внешний поиск и обновление недоступны. Сохранённые аниме можно найти в библиотеке.",
      );
    const cached = this.cached<CatalogPage>(key);
    if (cached) return cached;
    let value: CatalogData<CatalogPage>;
    try {
      value = { data: await primary(), source: "shikimori" };
    } catch (e) {
      checkAbort(signal);
      const cause = catalogError(e);
      console.error("Catalog Shikimori", cause);
      throw cause;
    }
    checkAbort(signal);
    value.data.items.forEach((a) => this.remember(a));
    return this.put(key, value);
  }
  async searchAnime(
    query: string,
    page = 1,
    filters: CatalogFilters = {},
    signal?: AbortSignal,
  ) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      query.trim().length > 300 ||
      (filters.year !== undefined &&
        (!Number.isInteger(filters.year) ||
          filters.year < 1900 ||
          filters.year > 2200))
    )
      throw new CatalogError("validation", "Проверьте год и поисковый запрос.");
    const group = JSON.stringify([query.trim(), filters]);
    return this.list(
      `search:${group}:${page}`,
      () => this.primary.searchAnime(query, page, filters, signal),
      signal,
    );
  }
  async getGenres(signal?: AbortSignal): Promise<CatalogData<CatalogGenre[]>> {
    const hit = this.cached<CatalogGenre[]>("genres");
    if (hit) return hit;
    try {
      const data = await this.primary.getGenres(signal);
      checkAbort(signal);
      return this.put("genres", { data, source: "shikimori" });
    } catch (e) {
      checkAbort(signal);
      console.error("Catalog genres", e);
      throw catalogError(e);
    }
  }
  getTopAnime(signal?: AbortSignal) {
    return this.list(
      "top",
      () => this.primary.getTopAnime(signal),
      signal,
    );
  }
  getCurrentSeason(signal?: AbortSignal) {
    return this.list(
      `season:${new Date().getFullYear()}:${Math.floor(new Date().getMonth() / 3)}`,
      () => this.primary.getCurrentSeason(signal),
      signal,
    );
  }
  async getAnimeById(
    provider: CatalogSource,
    id: string,
    signal?: AbortSignal,
    onLocal?: (result: CatalogData<CatalogAnime>) => void,
  ): Promise<CatalogData<CatalogAnime>> {
    if (
      !["shikimori", "jikan"].includes(provider) ||
      !/^[1-9]\d*$/.test(id) ||
      !Number.isSafeInteger(Number(id))
    )
      throw new CatalogError(
        "validation",
        "Некорректный источник или ID аниме.",
      );
    checkAbort(signal);
    const key = `detail:${provider}:${id}`;
    const hit = this.cached<CatalogAnime>(key);
    const local = await this.storage.find(provider, id);
    checkAbort(signal);
    if (local)
      onLocal?.({
        data: fromStored(local),
        source: local.provider === "shikimori" ? "shikimori" : "jikan",
        cached: true,
      });
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      if (local)
        return {
          data: fromStored(local),
          source: local.provider === "shikimori" ? "shikimori" : "jikan",
          cached: true,
          warning: "Нет сети. Показана сохранённая локальная карточка.",
        };
      throw new CatalogError(
        "unavailable",
        "Нет сети. Карточка ещё не сохранена на этом компьютере.",
      );
    }
    if (hit && !onLocal) return hit;
    let data: CatalogAnime;
    const shikimoriId = provider === "shikimori" ? id : local?.shikimoriId;
    try {
      if (!shikimoriId)
        throw new CatalogError("unavailable", "Для этой сохранённой записи неизвестен Shikimori ID. Доступны локальные данные.");
      data = await this.primary.getAnimeById("shikimori", shikimoriId, signal);
    } catch (e) {
      checkAbort(signal);
      const cause = catalogError(e);
      console.error("Catalog detail", cause);
      if (local)
        return {
          data: fromStored(local),
          source: local.provider === "shikimori" ? "shikimori" : "jikan",
          cached: true,
          warning: "Shikimori недоступен. Показана сохранённая локальная карточка.",
        };
      throw cause;
    }
    checkAbort(signal);
    const saved = await this.storage.save(data);
    checkAbort(signal);
    data = {
      ...fromStored(saved),
      provider: data.provider,
      providerId: data.providerId,
      local: false,
    };
    this.remember(data);
    return this.put(key, { data, source: "shikimori" });
  }
}
export const animeCatalog = new CatalogService();
