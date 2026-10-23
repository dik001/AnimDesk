import { AnimeCard } from "./AnimeCard";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import type { CatalogPage } from "../services/catalog/types";
import type { CatalogState } from "../services/catalog/useCatalog";
export function CatalogResults({
  state,
  onRetry,
}: {
  state: CatalogState<CatalogPage>;
  onRetry: () => void;
}) {
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error")
    return <ErrorState message={state.error.message} onRetry={onRetry} />;
  const { result } = state;
  return (
    <div aria-live="polite">
      {result.warning && (
        <p role="status" className="mb-4 text-sm text-amber-200">
          {result.warning}
        </p>
      )}
      {result.data.items.length ? (
        <ul
          aria-label="Результаты каталога"
          className="grid grid-cols-3 gap-5 lg:grid-cols-5"
        >
          {result.data.items.map((anime) => (
            <li key={`${anime.provider}:${anime.providerId}`}>
              <AnimeCard anime={anime} />
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="py-10 text-zinc-300">
          Ничего не найдено. Попробуйте другое название или фильтры.
        </p>
      )}
    </div>
  );
}
