import { LIBRARY_STATUSES, LIBRARY_STATUS_LABELS } from "../../types/anime";
export const controlClass =
  "rounded-xl border border-white/15 bg-[#282522] px-3 py-2.5 text-stone-100 disabled:opacity-40";
export function StatusOptions() {
  return LIBRARY_STATUSES.map((status) => (
    <option key={status} value={status}>
      {LIBRARY_STATUS_LABELS[status]}
    </option>
  ));
}
