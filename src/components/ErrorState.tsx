import { RotateCcw, TriangleAlert } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = "Не удалось загрузить данные",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <section
      className="rounded-3xl border border-rose-400/15 bg-rose-400/[0.035] p-8 text-center"
      role="alert"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mx-auto size-7 text-rose-300"
      />
      <h2 className="mt-4 text-lg font-semibold text-zinc-100">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-400">
        {message}
      </p>
      {onRetry ? (
        <button
          className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.08]"
          onClick={onRetry}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Повторить
        </button>
      ) : null}
    </section>
  );
}
