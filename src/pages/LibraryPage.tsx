import { BookOpen } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { AnimeCover } from "../components/AnimeCover";
import { Link } from "react-router-dom";
import { LibraryActions } from "../features/library/LibraryActions";
import { fromStored } from "../services/catalog/service";
import { useLibrary } from "../features/library/useLibrary";
import { controlClass } from "../features/library/controls";
import {
  LIBRARY_STATUSES,
  LIBRARY_STATUS_LABELS,
  type LibraryStatus,
} from "../types/anime";
import {
  filterLibrary,
  type LibrarySort,
} from "../features/library/filterLibrary";

export default function LibraryPage() {
  const [status, setStatus] = useState<LibraryStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("added");
  const { items, error, reload } = useLibrary();
  const visible = filterLibrary(items ?? [], status, query, sort);
  return (
    <>
      <PageHeader title="Моя библиотека" />
      <div
        aria-label="Фильтр по статусу"
        className="mb-5 flex flex-wrap gap-2"
        role="group"
      >
        {(["all", ...LIBRARY_STATUSES] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
            className={`rounded-xl border px-4 py-2.5 text-sm ${status === value ? "border-violet-accent/30 bg-violet-accent/15 text-violet-bright" : "border-white/10 text-zinc-300"}`}
          >
            {value === "all" ? "Все" : LIBRARY_STATUS_LABELS[value]} (
            {items
              ? items.filter((e) => value === "all" || e.status === value)
                  .length
              : "…"}
            )
          </button>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex-1 text-sm">
          Поиск в библиотеке
          <input
            type="search"
            className={`${controlClass} mt-1 block w-full`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="text-sm">
          Сортировка
          <select
            className={`${controlClass} mt-1 block`}
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
          >
            <option value="added">По дате добавления</option>
            <option value="updated">По последнему изменению</option>
            <option value="title">По названию</option>
            <option value="year">По году</option>
          </select>
        </label>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !items ? (
        <LoadingState />
      ) : !items.length ? (
        <EmptyState
          icon={BookOpen}
          title="Здесь пока нет аниме"
          description="Найдите аниме через поиск и добавьте его в библиотеку."
        />
      ) : !visible.length ? (
        <EmptyState
          icon={BookOpen}
          title="Нет подходящих записей"
          description="Измените статус или поисковый запрос."
        />
      ) : (
        <ol className="library-rows" aria-label="Аниме в вашем списке">
          {visible.map((entry, index) => {
            const anime = fromStored(entry.anime);
            const alternative =
              entry.anime.titles.find(
                (t) => t.language === "en" && t.title !== anime.title,
              )?.title ??
              entry.anime.titles.find((t) => t.title !== anime.title)?.title;
            const url = `/anime/${anime.provider}/${encodeURIComponent(anime.providerId)}`;
            return (
              <li key={entry.anime.id} className="library-row">
                <span className="library-row-number" aria-hidden="true">
                  {index + 1}.
                </span>
                <Link
                  to={url}
                  aria-label={`Открыть ${anime.title}`}
                  className="shrink-0 rounded-xl"
                >
                  <AnimeCover
                    url={anime.coverUrl}
                    title={anime.title}
                    className="library-row-cover"
                  />
                </Link>
                <div className="min-w-0 flex-1 py-2">
                  <Link to={url} className="library-row-title">
                    {anime.title}
                  </Link>
                  {alternative && (
                    <p className="mt-2 text-sm text-stone-300">{alternative}</p>
                  )}
                  <p className="mt-3 text-sm text-stone-400">
                    {LIBRARY_STATUS_LABELS[entry.status]} ·{" "}
                    {entry.watchedEpisodes} / {entry.anime.episodesTotal ?? "?"}{" "}
                    серий
                  </p>
                </div>
                <LibraryActions entry={entry} />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
