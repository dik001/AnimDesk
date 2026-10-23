import { useState } from "react";
import { libraryRepository } from "../../repositories/libraryRepository";
import { LOCAL_PROFILE_ID, type LibraryRecord } from "../../types/storage";
import type { LibraryStatus } from "../../types/anime";
import { assertProgress } from "../../repositories/validation";
import { ProgressInput } from "./ProgressInput";
import { LibraryActions } from "./LibraryActions";
import { controlClass, StatusOptions } from "./controls";
import { useLibraryMutation } from "./useLibraryMutation";

export function LibraryEditor({ entry }: { entry: LibraryRecord }) {
  const { run, busy, error, setError } = useLibraryMutation();
  const [draft, setDraft] = useState<{ base: number; value: string }>();
  const progress =
    draft?.base === entry.watchedEpisodes
      ? draft.value
      : String(entry.watchedEpisodes);
  const [notesDraft, setNotesDraft] = useState<{
    base: string | null;
    value: string;
  }>();
  const notes =
    notesDraft?.base === entry.notes ? notesDraft.value : (entry.notes ?? "");
  const commit = (value: string) => {
    const watched = value.trim() ? Number(value) : NaN;
    try {
      assertProgress(watched, entry.anime.episodesTotal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте прогресс.");
      return;
    }
    if (watched !== entry.watchedEpisodes)
      void run(() =>
        libraryRepository.updateProgress(
          LOCAL_PROFILE_ID,
          entry.anime.id,
          watched,
        ),
      );
  };
  return (
    <section
      className="mt-4 space-y-4 rounded-2xl border border-amber-200/10 p-3"
      aria-label={`Библиотека: ${entry.anime.title}`}
      aria-busy={busy}
    >
      <div className="flex items-start gap-2">
        <label className="min-w-0 flex-1 text-sm text-stone-300">
          Список
          <select
            className={`${controlClass} mt-2 w-full`}
            aria-label="Изменить статус"
            value={entry.status}
            onChange={(event) => {
              const status = event.target.value as LibraryStatus;
              void run(() =>
                libraryRepository.updateStatus(
                  LOCAL_PROFILE_ID,
                  entry.anime.id,
                  status,
                ),
              );
            }}
          >
            <StatusOptions />
          </select>
        </label>
        <div className="mt-6">
          <LibraryActions entry={entry} />
        </div>
      </div>
      <ProgressInput
        value={progress}
        total={entry.anime.episodesTotal}
        onChange={(value) => setDraft({ base: entry.watchedEpisodes, value })}
        onCommit={commit}
        disabled={busy}
      />
      {entry.anime.episodesTotal !== null &&
        entry.anime.episodesTotal > 0 &&
        entry.watchedEpisodes === entry.anime.episodesTotal &&
        entry.status !== "completed" && (
          <button
            type="button"
            className="text-sm text-amber-200 underline"
            onClick={() => {
              void run(() =>
                libraryRepository.updateStatus(
                  LOCAL_PROFILE_ID,
                  entry.anime.id,
                  "completed",
                ),
              );
            }}
          >
            Отметить как просмотренное
          </button>
        )}
      <label className="block text-sm text-stone-300">
        Заметки
        <textarea
          className={`${controlClass} mt-2 block w-full`}
          rows={3}
          value={notes}
          onChange={(event) =>
            setNotesDraft({ base: entry.notes, value: event.target.value })
          }
          onBlur={() => {
            if (notes !== (entry.notes ?? ""))
              void run(() =>
                libraryRepository.updateNotes(
                  LOCAL_PROFILE_ID,
                  entry.anime.id,
                  notes || null,
                ),
              );
          }}
        />
      </label>
      {busy && (
        <p role="status" className="text-xs text-stone-400">
          Сохранение…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </section>
  );
}
