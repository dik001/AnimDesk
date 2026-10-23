import { useState } from "react";
import { Modal } from "../../components/Modal";
import { libraryRepository } from "../../repositories/libraryRepository";
import { LOCAL_PROFILE_ID, type LibraryRecord } from "../../types/storage";
import type { LibraryStatus } from "../../types/anime";
import { assertProgress } from "../../repositories/validation";
import { PersonalRating } from "./PersonalRating";
import { ProgressInput } from "./ProgressInput";
import { controlClass, StatusOptions } from "./controls";
import { useLibraryMutation } from "./useLibraryMutation";

export function EditLibraryDialog({
  entry,
  onClose,
}: {
  entry: LibraryRecord;
  onClose: () => void;
}) {
  const [status, setStatus] = useState(entry.status);
  const [progress, setProgress] = useState(String(entry.watchedEpisodes));
  const [notes, setNotes] = useState(entry.notes ?? "");
  const { run, busy, error, setError } = useLibraryMutation();
  async function submit() {
    const watched = progress.trim() ? Number(progress) : NaN;
    try {
      assertProgress(watched, entry.anime.episodesTotal);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте прогресс.");
      return;
    }
    const ok = await run(() =>
      libraryRepository.update(LOCAL_PROFILE_ID, entry.anime.id, {
        status,
        watchedEpisodes: watched,
        notes: notes || null,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt,
      }),
    );
    if (ok) onClose();
  }
  return (
    <Modal title="Редактирование аниме" onClose={onClose} busy={busy}>
      <p className="mb-5 text-sm text-stone-400">{entry.anime.title}</p>
      <PersonalRating animeId={entry.anime.id} />
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <ProgressInput
          value={progress}
          total={entry.anime.episodesTotal}
          onChange={setProgress}
          disabled={busy}
        />
        <label className="block text-sm text-stone-300">
          Заметки
          <textarea
            className={`${controlClass} mt-2 block w-full`}
            rows={3}
            value={notes}
            disabled={busy}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className="block text-sm text-stone-300">
          Список
          <select
            className={`${controlClass} mt-2 w-full`}
            value={status}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value as LibraryStatus;
              setStatus(next);
              if (
                next === "completed" &&
                entry.anime.episodesTotal !== null &&
                entry.anime.episodesTotal > 0
              ) {
                setProgress(String(entry.anime.episodesTotal));
              }
            }}
          >
            <StatusOptions />
          </select>
        </label>
        {entry.anime.episodesTotal !== null &&
          entry.anime.episodesTotal > 0 &&
          Number(progress) === entry.anime.episodesTotal &&
          status !== "completed" && (
            <button
              type="button"
              className="text-sm text-amber-200 underline"
              onClick={() => setStatus("completed")}
            >
              Все серии просмотрены — отметить как просмотренное
            </button>
          )}
        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            className={controlClass}
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button
            className={`${controlClass} border-amber-200/30 text-amber-100`}
            disabled={busy}
          >
            {busy ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
