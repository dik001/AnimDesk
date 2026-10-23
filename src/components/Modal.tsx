import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useId } from "react";
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="animdesk-dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (event.target === event.currentTarget && outside && !busy) onClose();
      }}
    >
      <div className="mb-6 flex items-start justify-between gap-5">
        <h2 id={titleId} className="text-xl font-semibold text-stone-100">
          {title}
        </h2>
        <button
          type="button"
          className="rounded-lg p-1 text-stone-400 hover:text-white"
          aria-label="Закрыть окно"
          disabled={busy}
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}
