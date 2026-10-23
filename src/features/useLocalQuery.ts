import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { AppResult } from "../types/result";

export function useLocalQuery<T>(
  load: () => Promise<AppResult<T>>,
  event?: string,
) {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const token = ++request;
      if (!isTauri()) {
        setError("Локальные данные доступны в приложении AnimDesk для Windows.");
        return;
      }
      const result = await loader.current();
      if (!active || token !== request) return;
      if (result.ok) {
        setData(result.data);
        setError(undefined);
      } else {
        console.error("Local data", result.error);
        setError(result.error.message);
      }
    };
    const update = () => {
      void refresh();
    };
    update();
    if (event) window.addEventListener(event, update);
    return () => {
      active = false;
      if (event) window.removeEventListener(event, update);
    };
  }, [event, revision]);
  return { data, error, reload: () => setRevision((n) => n + 1) };
}
