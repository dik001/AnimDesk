import { useEffect, useRef, useState } from "react";
import { animeCatalog } from "../../services/catalog/service";
import { withDeadline } from "../../services/catalog/deadline";
import {
  catalogError,
  type CatalogAnime,
  type CatalogData,
  type CatalogSource,
} from "../../services/catalog/types";

export function useAnimeDetails(provider: string, id: string) {
  const key = `${provider}:${id}`;
  const [state, setState] = useState<{
    key: string;
    result?: CatalogData<CatalogAnime>;
    error?: string;
    refreshing?: boolean;
  }>({ key });
  const [revision, setRevision] = useState(0);
  const current = useRef(key);
  useEffect(() => {
    current.current = key;
    const controller = new AbortController();
    let local: CatalogData<CatalogAnime> | undefined;
    void withDeadline(
      () =>
        animeCatalog.getAnimeById(
          provider as CatalogSource,
          id,
          controller.signal,
          (result) => {
            local = result;
            if (!controller.signal.aborted)
              setState({ key, result, refreshing: true });
          },
        ),
      35_000,
      controller.signal,
      "Загрузка заняла слишком много времени. Повторите запрос.",
    )
      .then((result) => {
        if (!controller.signal.aborted && current.current === key)
          setState({ key, result });
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        const error = catalogError(cause);
        console.error("Anime details", error);
        setState({ key, result: local, error: error.message });
        controller.abort();
      });
    return () => controller.abort();
  }, [key, provider, id, revision]);
  return {
    state: state.key === key ? state : { key },
    reload: () => setRevision((n) => n + 1),
  };
}
