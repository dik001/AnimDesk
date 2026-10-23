import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <section
      className={`grid place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.018] px-8 text-center ${compact ? "min-h-56 py-10" : "min-h-[360px] py-16"}`}
    >
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl border border-violet-accent/20 bg-violet-accent/10 text-violet-bright">
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.7} />
        </span>
        <h2 className="mt-5 text-lg font-semibold text-zinc-100">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{description}</p>
        {action ? (
          <div className="mt-6 flex justify-center">{action}</div>
        ) : null}
      </div>
    </section>
  );
}
