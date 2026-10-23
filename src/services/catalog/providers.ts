import { catalogTransport } from "./transport";
import {
  object,
  positiveId,
  shikimoriPage,
  text,
} from "./mappers";
import {
  CatalogError,
  currentSeason,
  type AnimeCatalogProvider,
  type CatalogFilters,
  type CatalogGenre,
  type CatalogSource,
  type CatalogTransport,
} from "./types";
function mapGenres(data: unknown): CatalogGenre[] {
  if (!Array.isArray(data))
    throw new CatalogError("invalid_response", "Источник не передал жанры.");
  return data.map((value) => {
    const g = object(value);
    const id = positiveId(g.id ?? g.mal_id);
    const name = text(g.name);
    if (!id || !name)
      throw new CatalogError("invalid_response", "Некорректный жанр.");
    return { id: String(id), name, label: text(g.russian) ?? name };
  });
}
export class ShikimoriProvider implements AnimeCatalogProvider {
  private genres?: CatalogGenre[];
  async getGenres(signal?: AbortSignal) {
    if (this.genres) return this.genres;
    const root = object(
      await this.transport(
        { provider: "shikimori", operation: "genres" },
        signal,
      ),
    );
    if (root.errors && (!Array.isArray(root.errors) || root.errors.length > 0))
      throw new CatalogError(
        "graphql",
        "Не удалось загрузить жанры Shikimori.",
        root.errors,
      );
    return (this.genres = mapGenres(object(root.data).genres));
  }
  constructor(private transport: CatalogTransport = catalogTransport) {}
  async searchAnime(
    query: string,
    page = 1,
    filters: CatalogFilters = {},
    signal?: AbortSignal,
  ) {
    const genre = filters.genre
      ? (await this.getGenres(signal)).find((g) => g.name === filters.genre)?.id
      : undefined;
    if (filters.genre && !genre)
      throw new CatalogError(
        "unsupported_filter",
        "Этот жанр недоступен в Shikimori.",
      );
    return shikimoriPage(
      await this.transport(
        {
          provider: "shikimori",
          operation: "search",
          query,
          page,
          ...filters,
          genre,
        },
        signal,
      ),
      page,
    );
  }
  async getAnimeById(
    provider: CatalogSource,
    id: string,
    signal?: AbortSignal,
  ) {
    if (provider !== "shikimori")
      throw new CatalogError("validation", "Неверный источник.");
    const page = shikimoriPage(
      await this.transport({ provider, operation: "detail", id }, signal),
      1,
    );
    const anime = page.items.find((a) => a.providerId === id);
    if (!anime)
      throw new CatalogError("not_found", "Аниме не найдено в Shikimori.");
    return anime;
  }
  async getTopAnime(signal?: AbortSignal) {
    return shikimoriPage(
      await this.transport({ provider: "shikimori", operation: "top" }, signal),
      1,
    );
  }
  async getCurrentSeason(signal?: AbortSignal) {
    return shikimoriPage(
      await this.transport(
        { provider: "shikimori", operation: "season", season: currentSeason() },
        signal,
      ),
      1,
    );
  }
}
