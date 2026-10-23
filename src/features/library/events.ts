export const LIBRARY_CHANGED = "animdesk:library-changed";
export function libraryChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LIBRARY_CHANGED));
}
