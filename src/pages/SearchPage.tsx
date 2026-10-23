import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { CatalogResults } from "../components/CatalogResults";
import { animeCatalog } from "../services/catalog/service";
import { useCatalog } from "../services/catalog/useCatalog";
import type { CatalogFilters } from "../services/catalog/types";
export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [genre, setGenre] = useState("");
  const genres = useCatalog("genres", (s) => animeCatalog.getGenres(s));
  const [year, setYear] = useState("");
  const [kind, setKind] = useState("");
  const filters: CatalogFilters = {
    ...(genre ? { genre } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(kind ? { kind } : {}),
  };
  const key = JSON.stringify([query, page, filters]);
  const { state, reload } = useCatalog(
    key,
    (s) => animeCatalog.searchAnime(query, page, filters, s),
    400,
  );
  const input =
    "rounded-xl border border-white/15 bg-ink-950 px-4 py-3 text-zinc-100";
  return (
    <>
      <PageHeader title="Поиск аниме" />
      <form
        className="mb-7 space-y-4 rounded-2xl border border-white/10 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <label htmlFor="anime-query" className="block text-sm">
          Название аниме
        </label>
        <div className="flex gap-3">
          <input
            id="anime-query"
            maxLength={300}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Например, Death Note"
            className={`${input} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setPage(1);
              document.getElementById("anime-query")?.focus();
            }}
            className={input}
            disabled={!query}
          >
            Очистить
          </button>
          <button type="submit" className={input}>
            Найти
          </button>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            Год{" "}
            <input
              aria-label="Год"
              type="number"
              min={1900}
              max={2200}
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                setPage(1);
              }}
              className={`${input} ml-2 w-28`}
            />
          </label>
          <label className="text-sm">
            Тип{" "}
            <select
              aria-label="Тип"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPage(1);
              }}
              className={`${input} ml-2`}
            >
              <option value="">Все</option>
              <option value="tv">ТВ-сериал</option>
              <option value="movie">Фильм</option>
              <option value="ova">OVA</option>
              <option value="ona">ONA</option>
              <option value="special">Спецвыпуск</option>
            </select>
          </label>
          <label className="text-sm">
            Жанр{" "}
            <select
              aria-label="Жанр"
              value={genre}
              disabled={genres.state.status !== "ready"}
              onChange={(e) => {
                setGenre(e.target.value);
                setPage(1);
              }}
              className={`${input} ml-2 max-w-64`}
            >
              <option value="">Все</option>
              {genres.state.status === "ready" &&
                genres.state.result.data.map((g) => (
                  <option key={g.id} value={g.name}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {genres.state.status === "error" && (
          <p role="status" className="text-sm text-amber-200">
            Жанры недоступны: {genres.state.error.message}{" "}
            <button type="button" className="underline" onClick={genres.reload}>
              Повторить загрузку жанров
            </button>
          </p>
        )}
      </form>
      <CatalogResults state={state} onRetry={reload} />
      <nav
        aria-label="Страницы поиска"
        className="mt-6 flex items-center gap-4"
      >
        <button
          className={input}
          disabled={page === 1 || state.status === "loading"}
          onClick={() => setPage((n) => n - 1)}
        >
          Назад
        </button>
        <span aria-live="polite">Страница {page}</span>
        <button
          className={input}
          disabled={state.status !== "ready" || !state.result.data.hasNextPage}
          onClick={() => setPage((n) => n + 1)}
        >
          Далее
        </button>
      </nav>
    </>
  );
}
