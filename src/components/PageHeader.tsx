import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-8">
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-violet-bright uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-sm leading-6 text-zinc-400">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
