export function LoadingState({
  label = "Загрузка данных…",
}: {
  label?: string;
}) {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="rounded-3xl border border-white/[0.06] bg-ink-850 p-7"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="loading-pulse flex gap-6">
        <div className="h-52 w-36 shrink-0 rounded-2xl bg-white/[0.06]" />
        <div className="flex-1 space-y-4 pt-2">
          <div className="h-4 w-24 rounded-full bg-violet-accent/15" />
          <div className="h-8 w-3/5 rounded-lg bg-white/[0.07]" />
          <div className="h-4 w-full rounded-full bg-white/[0.045]" />
          <div className="h-4 w-4/5 rounded-full bg-white/[0.045]" />
        </div>
      </div>
    </div>
  );
}
