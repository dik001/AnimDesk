import { useRef, useState } from "react";
import type { AppResult } from "../../types/result";

export function useLibraryMutation() {
  const queue = useRef(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string>();
  const run = (action: () => Promise<AppResult<unknown>>) => {
    setPending((n) => n + 1);
    setError(undefined);
    let succeeded = false;
    const task = queue.current.then(async () => {
      try {
        const result = await action();
        if (result.ok) succeeded = true;
        else {
          console.error("Library write", result.error);
          setError(result.error.message);
        }
      } catch (cause) {
        console.error("Library write", cause);
        setError("Не удалось сохранить изменения.");
      } finally {
        setPending((n) => n - 1);
      }
    });
    queue.current = task;
    return task.then(() => succeeded);
  };
  return { run, busy: pending > 0, error, setError };
}
