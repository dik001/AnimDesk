import { CatalogError, type CatalogAnime, type CatalogPage } from "./types";
export function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const result = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\[\/?(?:[a-z][\w-]*)(?:=[^\]]*)?\]/gi, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (v) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&nbsp;": " ",
        })[v] ?? " ",
    )
    .trim();
  return result || null;
}
function strings(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map(text)
    .filter((t): t is string => t !== null);
}
export function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}
function number(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function episodes(v: unknown): number | null {
  const n = number(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}
export function coverUrl(
  value: unknown,
  source: "shikimori" | "jikan",
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(
      value,
      source === "shikimori"
        ? "https://shikimori.io"
        : "https://cdn.myanimelist.net",
    );
    const hosts =
      source === "shikimori"
        ? [
            "shikimori.one",
            "shikimori.io",
            "desu.shikimori.one",
            "desu.shikimori.io",
          ]
        : ["cdn.myanimelist.net"];
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hosts.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function requiredTitle(...values: unknown[]): string {
  const title = values.map(text).find(Boolean);
  if (!title)
    throw new CatalogError(
      "invalid_response",
      "Источник не передал название аниме.",
    );
  return title;
}
export function mapShikimori(value: unknown): CatalogAnime {
  const a = object(value);
  const id = positiveId(a.id);
  if (!id)
    throw new CatalogError(
      "invalid_response",
      "Некорректный Shikimori ID.",
      value,
    );
  const titles = [
    ["ru", a.russian],
    ["en", a.english],
    ["ja", a.japanese],
    ["und", a.name],
    ...strings(a.synonyms).map((s) => ["und", s]),
  ].flatMap(([language, title]) => {
    const t = text(title);
    return t ? [{ language: String(language), title: t }] : [];
  });
  return {
    id: null,
    provider: "shikimori",
    providerId: String(id),
    shikimoriId: String(id),
    malId: positiveId(a.malId),
    title: requiredTitle(a.russian, a.english, a.name, a.japanese),
    originalTitle: text(a.name),
    coverUrl: coverUrl(object(a.poster).mainUrl, "shikimori"),
    synopsis: text(a.description),
    episodeCount: episodes(a.episodes),
    year: positiveId(object(a.airedOn).year),
    format: text(a.kind),
    score: number(a.score),
    status: text(a.status),
    titles,
    genres: (Array.isArray(a.genres) ? a.genres : []).flatMap((g) => {
      const o = object(g);
      const n = text(o.russian) ?? text(o.name);
      return n ? [n] : [];
    }),
    related: (Array.isArray(a.related) ? a.related : []).flatMap((r) => {
      const o = object(r);
      const anime = object(o.anime);
      const relatedId = positiveId(anime.id);
      const title = text(anime.russian) ?? text(anime.name);
      return relatedId && title
        ? [
            {
              provider: "shikimori" as const,
              providerId: String(relatedId),
              title,
              coverUrl: coverUrl(object(anime.poster).mainUrl, "shikimori"),
              year: positiveId(object(anime.airedOn).year),
              format: text(anime.kind),
              relation: text(o.relationText) ?? "Связанное аниме",
            },
          ]
        : [];
    }),
  };
}
export function mapJikan(value: unknown): CatalogAnime {
  const a = object(value);
  const id = positiveId(a.mal_id);
  if (!id)
    throw new CatalogError("invalid_response", "Некорректный MAL ID.", value);
  const titles = (Array.isArray(a.titles) ? a.titles : []).flatMap((t) => {
    const o = object(t);
    const title = text(o.title);
    return title
      ? [
          {
            language:
              o.type === "English"
                ? "en"
                : o.type === "Japanese"
                  ? "ja"
                  : "und",
            title,
          },
        ]
      : [];
  });
  return {
    id: null,
    provider: "jikan",
    providerId: String(id),
    shikimoriId: null,
    malId: id,
    title: requiredTitle(a.title_english, a.title, a.title_japanese),
    originalTitle: text(a.title),
    coverUrl: coverUrl(object(object(a.images).jpg).image_url, "jikan"),
    synopsis: text(a.synopsis),
    episodeCount: episodes(a.episodes),
    year:
      positiveId(a.year) ??
      positiveId(object(object(object(a.aired).prop).from).year),
    format: text(a.type)?.toLowerCase() ?? null,
    score: number(a.score),
    status: text(a.status),
    titles,
    genres: (Array.isArray(a.genres) ? a.genres : []).flatMap((g) => {
      const n = text(object(g).name);
      return n ? [n] : [];
    }),
    related: [],
  };
}
export function shikimoriPage(value: unknown, page: number): CatalogPage {
  const root = object(value);
  if (
    root.errors !== undefined &&
    root.errors !== null &&
    (!Array.isArray(root.errors) || root.errors.length)
  )
    throw new CatalogError(
      "graphql",
      "Shikimori вернул ошибку GraphQL.",
      root.errors,
    );
  const items = object(root.data).animes;
  if (!Array.isArray(items))
    throw new CatalogError(
      "invalid_response",
      "Shikimori не передал список аниме.",
      value,
    );
  return {
    items: items.map(mapShikimori),
    page,
    hasNextPage: items.length === 20,
  };
}
export function jikanPage(value: unknown, page: number): CatalogPage {
  const root = object(value);
  if (
    !Array.isArray(root.data) ||
    typeof object(root.pagination).has_next_page !== "boolean"
  )
    throw new CatalogError(
      "invalid_response",
      "Источник не передал список или пагинацию.",
      value,
    );
  return {
    items: root.data.map(mapJikan),
    page,
    hasNextPage: object(root.pagination).has_next_page === true,
  };
}
