import { withDeadline } from "./deadline";
import { useEffect, useRef, useState } from "react";
import { catalogError, type CatalogData, type CatalogError } from "./types";
export type CatalogState<T> =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; error: CatalogError }
  | { key: string; status: "ready"; result: CatalogData<T> };
export function useCatalog<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<CatalogData<T>>,
  delay = 0,
) {
  const [state, setState] = useState<CatalogState<T>>({
    key,
    status: "loading",
  });
  const [retry, setRetry] = useState(0);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void withDeadline(
        () => loader.current(controller.signal),
        35_000,
        controller.signal,
        "Загрузка заняла слишком много времени. Повторите запрос.",
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setState({ key, status: "ready", result });
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            const error = catalogError(e);
            console.error("Catalog UI", error);
            setState({ key, status: "error", error });
            controller.abort();
          }
        });
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, retry, delay]);
  return {
    state: state.key === key ? state : { key, status: "loading" as const },
    reload: () => {
      setState({ key, status: "loading" });
      setRetry((n) => n + 1);
    },
  };
}
