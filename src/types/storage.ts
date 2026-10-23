import type { LibraryStatus } from "./anime";

export const LOCAL_PROFILE_ID = "local-default";

export interface Profile {
  id: string;
  displayName: string;
  avatarPath: string | null;
  createdAt: string;
}

export interface AnimeTitle {
  language: string;
  title: string;
}

export interface StoredAnime {
  id: number;
  provider: string;
  providerId: string;
  shikimoriId: string | null;
  malId: number | null;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  coverCachePath: string | null;
  year: number | null;
  format: string | null;
  episodesTotal: number | null;
  communityScore: number | null;
  fetchedAt: string;
  metadataJson?: string | null;
  titles: AnimeTitle[];
  genres: string[];
}

export interface AnimeUpsertInput {
  provider: string;
  providerId: string;
  shikimoriId: string | null;
  malId: number | null;
  title: string;
  synopsis: string | null;
  coverUrl: string | null;
  coverCachePath: string | null;
  year: number | null;
  format: string | null;
  episodesTotal: number | null;
  communityScore: number | null;
  fetchedAt: string;
  metadataJson?: string | null;
  titles: AnimeTitle[];
  genres: string[];
}

export interface LibraryRecord {
  profileId: string;
  anime: StoredAnime;
  status: LibraryStatus;
  watchedEpisodes: number;
  notes: string | null;
  addedAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AddLibraryEntryInput {
  profileId: string;
  animeId: number;
  status: LibraryStatus;
  watchedEpisodes?: number;
  notes?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface UpdateLibraryEntryInput {
  status: LibraryStatus;
  watchedEpisodes: number;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface LibraryStatistics {
  totalEntries: number;
  totalWatchedEpisodes: number;
  byStatus: Record<LibraryStatus, number>;
}
