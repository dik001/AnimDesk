import { withDeadline } from "./deadline";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  CatalogError,
  catalogError,
  checkAbort,
  type CatalogTransport,
} from "./types";
export const catalogTransport: CatalogTransport = async (request, signal) => {
  checkAbort(signal);
  if (!isTauri())
    throw new CatalogError(
      "desktop",
      "Сетевой каталог доступен в приложении AnimDesk для Windows.",
    );
  try {
    const data: unknown = await withDeadline(
      () => invoke("catalog_request", { request }),
      14_000,
      signal,
    );
    checkAbort(signal);
    return data;
  } catch (e) {
    checkAbort(signal);
    throw catalogError(e);
  }
};
