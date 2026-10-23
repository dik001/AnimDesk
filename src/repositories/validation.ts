import { LIBRARY_STATUSES, type LibraryStatus } from "../types/anime";

export function requireText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Поле «${fieldName}» не может быть пустым.`);
  }
  return normalized;
}

export function assertLibraryStatus(status: string): asserts status is LibraryStatus {
  if (!LIBRARY_STATUSES.includes(status as LibraryStatus)) {
    throw new Error("Неизвестный статус библиотеки.");
  }
}

export function assertProgress(
  watchedEpisodes: number,
  episodesTotal: number | null,
): void {
  if (!Number.isSafeInteger(watchedEpisodes) || watchedEpisodes < 0) {
    throw new Error("Прогресс должен быть целым неотрицательным числом.");
  }

  if (episodesTotal !== null && watchedEpisodes > episodesTotal) {
    throw new Error(
      `Прогресс не может превышать известное число серий (${episodesTotal}).`,
    );
  }
}
