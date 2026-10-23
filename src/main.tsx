import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { initializeDatabase } from "./database/initializeDatabase";
import "./styles.css";
import { isTauri } from "@tauri-apps/api/core";
import { loadTheme } from "./features/theme";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Не найден корневой элемент приложения");
}

const reactRoot = createRoot(root);

void initializeDatabase()
  .then(async () => {
    if (isTauri()) await loadTheme();
    reactRoot.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    console.error("Не удалось инициализировать локальную базу AnimDesk", error);
    reactRoot.render(
      <main className="flex min-h-screen items-center justify-center bg-ink-950 p-8 text-white">
        <section
          role="alert"
          className="max-w-xl rounded-2xl border border-red-400/40 bg-ink-850 p-6"
        >
          <h1 className="text-xl font-semibold">
            Не удалось открыть локальные данные
          </h1>
          <p className="mt-3 text-sm text-zinc-400">
            Перезапустите AnimDesk. Если ошибка повторится, сохраните технический
            журнал для диагностики.
          </p>
        </section>
      </main>,
    );
  });
