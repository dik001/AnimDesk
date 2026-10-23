import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
const COVERS_READY = "animdesk:covers-ready";
import { LIBRARY_CHANGED } from "./library/events";
export function useCachedCover(url: string | null) {
  const [image, setImage] = useState<{ url: string; data: string | null }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((n) => n + 1);
    window.addEventListener(LIBRARY_CHANGED, changed);
    window.addEventListener("online", changed);
    window.addEventListener(COVERS_READY, changed);
    return () => {
      window.removeEventListener(LIBRARY_CHANGED, changed);
      window.removeEventListener("online", changed);
      window.removeEventListener(COVERS_READY, changed);
    };
  }, []);
  useEffect(() => {
    if (!url || !isTauri()) return;
    let active = true;
    void invoke<{ saved: boolean; data: string | null }>("cover_image", { url })
      .then((result) => {
        if (active) setImage({ url, data: result.saved ? result.data : url });
      })
      .catch((cause) => {
        console.error("Cover image", cause);
        if (active) setImage({ url, data: null });
      });
    return () => {
      active = false;
    };
  }, [url, revision]);
  return !isTauri() ? url : image?.url === url ? image.data : null;
}
let warming: Promise<void> | undefined;
let queued = false;
export function warmCovers() {
  if (!isTauri() || !navigator.onLine) return;
  if (warming) {
    queued = true;
    return;
  }
  warming = invoke<void>("warm_covers")
    .catch((cause) => console.error("Cover cache", cause))
    .finally(() => {
      warming = undefined;
      window.dispatchEvent(new Event(COVERS_READY));
      if (queued) {
        queued = false;
        warmCovers();
      }
    });
}
