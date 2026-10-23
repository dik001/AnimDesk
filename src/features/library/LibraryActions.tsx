import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Modal } from "../../components/Modal";
import { libraryRepository } from "../../repositories/libraryRepository";
import { LOCAL_PROFILE_ID, type LibraryRecord } from "../../types/storage";
import { controlClass } from "./controls";
import { EditLibraryDialog } from "./EditLibraryDialog";
import { useLibraryMutation } from "./useLibraryMutation";

export function LibraryActions({ entry }: { entry: LibraryRecord }) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const { run, busy, error } = useLibraryMutation();
  const closeMenu = () => {
    if (disclosure.current) disclosure.current.open = false;
  };
  return (
    <>
      <details
        ref={disclosure}
        className="library-actions relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            closeMenu();
            disclosure.current?.querySelector("summary")?.focus();
          }
        }}
      >
        <summary
          className="flex cursor-pointer list-none items-center justify-center rounded-lg p-2 text-stone-400 hover:bg-white/5 hover:text-amber-100"
          aria-label={`Действия: ${entry.anime.title}`}
        >
          <MoreHorizontal aria-hidden="true" className="size-6" />
        </summary>
        <div className="library-actions-menu">
          <button
            type="button"
            onClick={() => {
              setEdit(true);
              closeMenu();
            }}
          >
            Редактировать
          </button>
          <button
            type="button"
            className="text-rose-300"
            onClick={() => {
              setRemove(true);
              closeMenu();
            }}
          >
            Убрать из списка
          </button>
        </div>
      </details>
      {edit && (
        <EditLibraryDialog entry={entry} onClose={() => setEdit(false)} />
      )}
      {remove && (
        <Modal
          title="Убрать из списка?"
          onClose={() => setRemove(false)}
          busy={busy}
        >
          <p className="mb-3 leading-6 text-stone-300">
            «{entry.anime.title}» будет убрано из списка. Прогресс и заметки
            будут удалены.
          </p>
          <p className="mb-6 text-sm text-stone-400">
            Ваша оценка и данные аниме сохранятся.
          </p>
          {error && (
            <p role="alert" className="mb-4 text-sm text-rose-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              autoFocus
              type="button"
              className={controlClass}
              disabled={busy}
              onClick={() => setRemove(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className={`${controlClass} border-rose-300/30 text-rose-200`}
              disabled={busy}
              onClick={() => {
                void run(() =>
                  libraryRepository.remove(LOCAL_PROFILE_ID, entry.anime.id),
                ).then((ok) => {
                  if (ok) setRemove(false);
                });
              }}
            >
              Подтвердить удаление
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
