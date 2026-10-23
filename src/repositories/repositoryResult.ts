import type { AppResult } from "../types/result";

export async function storageResult<T>(
  message: string,
  operation: () => Promise<T>,
): Promise<AppResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "storage",
        message,
        cause,
      },
    };
  }
}
