export function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="logo-mark relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-violet-bright via-violet-accent to-indigo-700 shadow-lg shadow-violet-950/40"
    >
      <span className="h-4 w-5 -rotate-12 rounded-[50%_50%_45%_45%] border-2 border-white/90" />
      <span className="absolute -right-1 -bottom-2 size-5 rounded-full bg-white/20" />
    </span>
  );
}
