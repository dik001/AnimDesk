import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { CatalogResults } from "../components/CatalogResults";
import { AnimeCover } from "../components/AnimeCover";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { animeCatalog } from "../services/catalog/service";
import { useCatalog } from "../services/catalog/useCatalog";
import { currentSeason, currentSeasonTitle } from "../services/catalog/types";
import { useLibrary } from "../features/library/useLibrary";
import { useOnline } from "../features/useOnline";

function OnlineCatalog({
  season,
  popular = false,
  onFailure,
}: {
  season: string;
  popular?: boolean;
  onFailure: (failed: boolean) => void;
}) {
  const { state, reload } = useCatalog(
    popular ? "popular" : season,
    (signal) =>
      popular
        ? animeCatalog.getTopAnime(signal)
        : animeCatalog.getCurrentSeason(signal),
  );
  useEffect(() => {
    onFailure(state.status === "error");
  }, [state.status, onFailure]);
  return <CatalogResults state={state} onRetry={reload} />;
}
export default function HomePage() {
  const [season, setSeason] = useState(() => currentSeason());
  const online = useOnline();
  const [seasonFailed, setSeasonFailed] = useState(false);
  const [popularFailed, setPopularFailed] = useState(false);
  const localOnly = !online || (seasonFailed && popularFailed);
  const library = useLibrary();
  useEffect(() => {
    const update = () => setSeason(currentSeason());
    const timer = window.setInterval(update, 60_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const watching = library.items?.filter(
    (entry) => entry.status === "watching",
  );
  const visible = localOnly ? library.items : watching;
  return (
    <>
      <PageHeader title="Главная" />
      <section className="mb-9 py-6">
        <h2 className="text-3xl font-semibold">
          История <span className="text-violet-bright">начинается здесь</span>
        </h2>
      </section>
      <section aria-labelledby="continue-heading" className="mb-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="continue-heading" className="text-xl font-semibold">
            {localOnly ? "Локальная библиотека" : "Продолжить просмотр"}
          </h2>
          <Link to="/library" className="text-sm text-violet-bright underline">
            Вся библиотека
          </Link>
        </div>
        {localOnly && (
          <p role="status" className="mb-4 text-zinc-400">
            {online ? "Онлайн-разделы недоступны." : "Нет подключения к сети."}{" "}
            Сохранённые данные и ручной прогресс доступны локально.
          </p>
        )}
        {library.error && (
          <ErrorState message={library.error} onRetry={library.reload} />
        )}
        {!visible && !library.error && (
          <LoadingState label="Загрузка библиотеки…" />
        )}
        {visible &&
          (visible.length ? (
            <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {visible.map((entry) => (
                <li key={entry.anime.id}>
                  <Link
                    className="surface flex items-center gap-4 hover:border-violet-accent/50"
                    to={`/anime/${encodeURIComponent(entry.anime.provider)}/${encodeURIComponent(entry.anime.providerId)}`}
                  >
                    <AnimeCover
                      url={entry.anime.coverUrl}
                      title={entry.anime.title}
                      className="h-24 w-16 shrink-0 rounded-lg object-cover"
                    />
                    <div className="min-w-0">
                      <h3 className="break-words font-medium">
                        {entry.anime.title}
                      </h3>
                      <p className="mt-2 text-sm text-zinc-400">
                        Отмечено серий: {entry.watchedEpisodes} /{" "}
                        {entry.anime.episodesTotal ?? "?"}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : localOnly ? (
            <div className="surface text-sm text-zinc-400">
              <p>
                {localOnly
                  ? "В локальной библиотеке пока нет аниме."
                  : "В списке «Смотрю» пока нет аниме."}
              </p>
              <Link
                className="mt-3 inline-block text-violet-bright underline"
                to={localOnly ? "/library" : "/search"}
              >
                {localOnly ? "Открыть библиотеку" : "Найти аниме"}
              </Link>
            </div>
          ) : null)}
      </section>
      {[
        { title: currentSeasonTitle(), popular: false },
        { title: "Популярное аниме", popular: true },
      ].map((block) => (
        <section
          key={String(block.popular)}
          className="mb-10"
          aria-label={block.title}
        >
          <h2 className="mb-5 text-xl font-semibold">{block.title}</h2>
          {online ? (
            <OnlineCatalog
              season={season}
              popular={block.popular}
              onFailure={block.popular ? setPopularFailed : setSeasonFailed}
            />
          ) : (
            <p role="status" className="surface text-sm text-zinc-400">
              Нет сети. Этот раздел обновится после подключения.
            </p>
          )}
        </section>
      ))}
    </>
  );
}
