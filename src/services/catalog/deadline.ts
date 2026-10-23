import { CatalogError, catalogError } from "./types";

function abortError(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException("Запрос отменён", "AbortError");
}

// Bounds the entire operation, including IPC/queue waits. Late completions are ignored.
export function withDeadline<T>(
  operation: () => Promise<T>,
  milliseconds: number,
  signal?: AbortSignal,
  message = "Источник не ответил вовремя. Повторите запрос.",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(abortError(signal)));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new CatalogError("timeout", message, { milliseconds })),
        ),
      milliseconds,
    );
    signal?.addEventListener("abort", abort, { once: true });
    void Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => {
          const failure = error instanceof Error ? error : catalogError(error);
          finish(() => reject(failure));
        },
      );
  });
}
