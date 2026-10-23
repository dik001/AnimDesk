import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { libraryRepository } from "../../repositories/libraryRepository";
import { LOCAL_PROFILE_ID, type LibraryRecord } from "../../types/storage";
import { LIBRARY_CHANGED } from "./events";

export function useLibrary() {
  const [items, setItems] = useState<LibraryRecord[]>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let request = 0;
    const load = async () => {
      const token = ++request;
      if (!isTauri()) {
        setError(
          "Локальная библиотека доступна в приложении AnimDesk для Windows.",
        );
        return;
      }
      const result = await libraryRepository.list(LOCAL_PROFILE_ID);
      if (!active || token !== request) return;
      if (result.ok) {
        setItems(result.data);
        setError(undefined);
      } else {
        console.error("Library", result.error);
        setError(result.error.message);
      }
    };
    const refresh = () => {
      void load();
    };
    refresh();
    window.addEventListener(LIBRARY_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(LIBRARY_CHANGED, refresh);
    };
  }, [revision]);
  return { items, error, reload: () => setRevision((n) => n + 1) };
}
