import { PersonalRating } from "../features/library/PersonalRating";
import { CommunityScore } from "../components/CommunityScore";
import { RelatedAnime } from "../components/RelatedAnime";
import { AnimeCover } from "../components/AnimeCover";
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useRef, useState } from "react";
import { useAnimeDetails } from "../features/library/useAnimeDetails";
import { useLibrary } from "../features/library/useLibrary";
import { LibraryEditor } from "../features/library/LibraryEditor";
import { controlClass } from "../features/library/controls";
import { catalogStore } from "../services/catalog/storage";
import { libraryRepository } from "../repositories/libraryRepository";
import { LOCAL_PROFILE_ID } from "../types/storage";
import { formatLabel } from "../services/catalog/types";
export default function AnimePage() {
  const { provider = "", id = "" } = useParams();
  const { state, reload } = useAnimeDetails(provider, id);
  const library = useLibrary();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [saveError, setSaveError] = useState<string>();
  async function add() {
    if (lock.current || !state.result) return;
    lock.current = true;
    setBusy(true);
    setSaveError(undefined);
    try {
      const saved = await catalogStore.save(state.result.data);
      const result = await libraryRepository.add({
        profileId: LOCAL_PROFILE_ID,
        animeId: saved.id,
        status: "watching",
      });
      if (!result.ok) {
        console.error("Add library", result.error);
        setSaveError(result.error.message);
      }
    } catch (cause) {
      console.error("Add library", cause);
      setSaveError(
        cause instanceof Error ? cause.message : "Не удалось добавить аниме.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!state.result && !state.error)
    return (
      <>
        <PageHeader title="Страница аниме" />
        <LoadingState />
      </>
    );
  if (!state.result)
    return (
      <>
        <PageHeader title="Страница аниме" />
        <ErrorState
          message={state.error ?? "Не удалось загрузить аниме."}
          onRetry={reload}
        />
      </>
    );
  const { data: anime, warning } = state.result;
  const entry = library.items?.find(
    (e) =>
      e.anime.id === anime.id ||
      (anime.shikimoriId && e.anime.shikimoriId === anime.shikimoriId) ||
      (anime.malId && e.anime.malId === anime.malId),
  );
  return (
    <>
      {warning && (
        <p role="status" className="mb-5 text-amber-200">
          {warning}
        </p>
      )}
      {state.refreshing && (
        <p role="status" className="mb-4 text-sm text-zinc-400">
          Показаны локальные данные. Обновление метаданных…
        </p>
      )}
      {state.error && <ErrorState message={state.error} onRetry={reload} />}
      <article className="anime-detail flex items-start gap-8">
        <aside className="w-52 shrink-0" aria-label="Обложка и библиотека">
          <AnimeCover
            url={anime.coverUrl}
            title={anime.title}
            className="w-full rounded-2xl border border-amber-200/15"
          />
          {library.error ? (
            <ErrorState message={library.error} onRetry={library.reload} />
          ) : !library.items ? (
            <LoadingState />
          ) : entry ? (
            <LibraryEditor key={entry.anime.id} entry={entry} />
          ) : (
            <section
              className="anime-library-add"
              aria-label="Добавление в библиотеку"
              aria-busy={busy}
            >
              <button
                type="button"
                className={`${controlClass} w-full`}
                disabled={busy}
                onClick={() => {
                  void add();
                }}
              >
                {busy ? "Добавление…" : "Добавить в список"}
              </button>
              {saveError && (
                <p role="alert" className="text-rose-300">
                  {saveError}
                </p>
              )}
            </section>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          <PersonalRating key={anime.id} animeId={anime.id} />
          <PageHeader title={anime.title} />
          <dl className="anime-metadata">
            <dt>Статус выхода</dt>
            <dd
              className={
                anime.status === "ongoing" ||
                anime.status === "Currently Airing"
                  ? "release-ongoing"
                  : undefined
              }
            >
              {(
                {
                  announced: "Анонсировано",
                  ongoing: "Онгоинг",
                  released: "Вышло",
                  "Currently Airing": "Онгоинг",
                  "Finished Airing": "Вышло",
                  "Not yet aired": "Ещё не вышло",
                } as Record<string, string>
              )[anime.status ?? ""] ??
                anime.status ??
                "Неизвестно"}
            </dd>
            <dt>Год</dt>
            <dd>{anime.year ?? "Не указан"}</dd>
            <dt>Тип</dt>
            <dd>{formatLabel(anime.format)}</dd>
            <dt>Серий</dt>
            <dd>{anime.episodeCount ?? "Неизвестно"}</dd>
            <dt>Рейтинг каталога</dt>
            <dd>
              <CommunityScore score={anime.score} />
            </dd>
            <dt>Жанры</dt>
            <dd>{anime.genres.join(", ") || "Не указаны"}</dd>
          </dl>
          <p className="mt-6 whitespace-pre-line leading-7 text-stone-200">
            {anime.synopsis ?? "Описание отсутствует у источника."}
          </p>
          {!!anime.titles.length && (
            <details className="mt-6 text-stone-300">
              <summary className="cursor-pointer text-amber-100">
                Другие названия
              </summary>
              <ul>
                {anime.titles.map((t, i) => (
                  <li key={i}>
                    {t.title} ({t.language})
                  </li>
                ))}
              </ul>
            </details>
          )}
          <RelatedAnime items={anime.related} />
        </div>
      </article>
    </>
  );
}
