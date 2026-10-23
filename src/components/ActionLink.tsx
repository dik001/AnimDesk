import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { PropsWithChildren } from "react";

export function ActionLink({
  to,
  children,
}: PropsWithChildren<{ to: string }>) {
  return (
    <Link
      to={to}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-accent px-5 py-3 text-sm font-semibold text-white transition hover:bg-violet-500"
    >
      {children}
      <ArrowUpRight aria-hidden="true" className="size-4" />
    </Link>
  );
}
