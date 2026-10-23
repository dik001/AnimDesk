export const LIBRARY_STATUSES = [
  "watching",
  "planned",
  "completed",
  "on_hold",
  "dropped",
] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const LIBRARY_STATUS_LABELS: Readonly<Record<LibraryStatus, string>> = {
  watching: "Смотрю",
  planned: "В планах",
  completed: "Просмотрено",
  on_hold: "Отложено",
  dropped: "Брошено",
};

export interface ProviderAnimeIdentity {
  provider: string;
  providerId: string;
}

export interface AnimeIdentity extends ProviderAnimeIdentity {
  shikimoriId: string | null;
  malId: number | null;
}

export interface AnimeMetadata extends AnimeIdentity {
  title: string;
  originalTitle: string | null;
  coverUrl: string | null;
  synopsis: string | null;
  episodeCount: number | null;
  year: number | null;
}

export interface LibraryEntry {
  anime: AnimeMetadata;
  status: LibraryStatus;
  watchedEpisodes: number;
  updatedAt: string;
}
