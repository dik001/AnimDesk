import { libraryChanged } from "../../features/library/events";
import { isTauri } from "@tauri-apps/api/core";
import { animeRepository } from "../../repositories/animeRepository";
import type { StoredAnime, AnimeUpsertInput } from "../../types/storage";
import { CatalogError, type CatalogAnime, type CatalogSource } from "./types";
import { coverUrl } from "./mappers";
export interface CatalogStore {
  find: (source: CatalogSource, id: string) => Promise<StoredAnime | null>;
  save: (anime: CatalogAnime) => Promise<StoredAnime>;
}
export const catalogStore: CatalogStore = {
  async find(source, id) {
    if (!isTauri()) return null;
    const exact = await animeRepository.find(source, id);
    if (!exact.ok)
      throw new CatalogError(
        exact.error.code,
        exact.error.message,
        exact.error.cause,
      );
    if (exact.data) return exact.data;
    const external =
      source === "shikimori"
        ? await animeRepository.findByShikimoriId(id)
        : await animeRepository.findByMalId(Number(id));
    if (!external.ok)
      throw new CatalogError(
        external.error.code,
        external.error.message,
        external.error.cause,
      );
    return external.data;
  },
  async save(anime) {
    const existing = await this.find(anime.provider, anime.providerId);
    const byMal =
      !existing && anime.malId
        ? await animeRepository.findByMalId(anime.malId)
        : null;
    if (byMal && !byMal.ok)
      throw new CatalogError(
        byMal.error.code,
        byMal.error.message,
        byMal.error.cause,
      );
    const byShiki =
      !existing && anime.shikimoriId
        ? await animeRepository.findByShikimoriId(anime.shikimoriId)
        : null;
    if (byShiki && !byShiki.ok)
      throw new CatalogError(
        byShiki.error.code,
        byShiki.error.message,
        byShiki.error.cause,
      );
    const previous =
      existing ??
      (byMal?.ok ? byMal.data : null) ??
      (byShiki?.ok ? byShiki.data : null);
    const result = await animeRepository.upsert(toUpsertInput(anime, previous));
    if (!result.ok)
      throw new CatalogError(
        result.error.code,
        result.error.message,
        result.error.cause,
      );
    libraryChanged();
    return result.data;
  },
};
export function fromStored(a: StoredAnime): CatalogAnime {
  const provider = a.provider === "shikimori" ? "shikimori" : "jikan";
  return {
    ...a,
    local: true,
    provider,
    coverUrl:
      coverUrl(a.coverUrl, provider) ??
      coverUrl(a.coverUrl, provider === "shikimori" ? "jikan" : "shikimori"),
    episodeCount: a.episodesTotal,
    score: a.communityScore,
    originalTitle: a.titles.find((t) => t.language === "en")?.title ?? null,
    ...readDetailMetadata(a.metadataJson),
  };
}

export function toUpsertInput(
  anime: CatalogAnime,
  existing: StoredAnime | null,
): AnimeUpsertInput {
  const preserveTitle =
    existing?.titles.some((t) => t.language === "ru") &&
    !anime.titles.some((t) => t.language === "ru");
  const previous = readDetailMetadata(existing?.metadataJson);
  return {
    ...anime,
    title: preserveTitle ? existing!.title : anime.title,
    synopsis:
      (anime.provider === "jikan" && existing?.shikimoriId
        ? existing.synopsis
        : anime.synopsis) ??
      existing?.synopsis ??
      null,
    titles: [...(existing?.titles ?? []), ...anime.titles],
    genres: anime.genres.length ? anime.genres : (existing?.genres ?? []),
    coverUrl: anime.coverUrl ?? existing?.coverUrl ?? null,
    year: anime.year ?? existing?.year ?? null,
    format: anime.format ?? existing?.format ?? null,
    coverCachePath: existing?.coverCachePath ?? null,
    episodesTotal: anime.episodeCount ?? existing?.episodesTotal ?? null,
    communityScore: anime.score ?? existing?.communityScore ?? null,
    metadataJson: JSON.stringify({
      status: anime.status ?? previous.status,
      related: anime.related.length ? anime.related : previous.related,
    }),
    fetchedAt: new Date().toISOString(),
  };
}

export function readDetailMetadata(
  json?: string | null,
): Pick<CatalogAnime, "status" | "related"> {
  if (!json) return { status: null, related: [] };
  try {
    const data = JSON.parse(json) as Pick<CatalogAnime, "status" | "related">;
    return {
      status: typeof data.status === "string" ? data.status : null,
      related: Array.isArray(data.related)
        ? data.related.filter(
            (r) =>
              ["shikimori", "jikan"].includes(r.provider) &&
              /^[1-9]\d*$/.test(r.providerId) &&
              typeof r.title === "string" &&
              typeof r.relation === "string",
          )
        : [],
    };
  } catch (cause) {
    console.error("Saved detail metadata", cause);
    return { status: null, related: [] };
  }
}
