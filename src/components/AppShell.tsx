import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Suspense } from "react";
import { LoadingState } from "./LoadingState";

export function AppShell() {
  return (
    <div className="flex h-screen min-h-[650px] min-w-[1000px] bg-ink-950 text-zinc-100">
      <Sidebar />
      <main
        tabIndex={-1}
        className="relative min-w-0 flex-1 overflow-y-auto"
        id="main-content"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 h-44 bg-gradient-to-b from-violet-950/10 to-transparent"
        />
        <div className="relative mx-auto min-h-full max-w-[1480px] px-8 py-8 xl:px-12 xl:py-10">
          <Suspense fallback={<LoadingState label="Открываем экран…" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
