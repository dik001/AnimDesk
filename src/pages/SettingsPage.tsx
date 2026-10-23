import { useEffect, useState } from "react";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { isTauri } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { TransferPanel } from "../features/TransferPanel";
import { PageHeader } from "../components/PageHeader";
import { applyTheme, saveTheme, type Theme } from "../features/theme";
import { useNotification } from "../features/notifications/useNotification";
import { version } from "../../package.json";

export default function SettingsPage() {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [path, setPath] = useState<string>();
  const [pathError, setPathError] = useState(false);
  const { notify } = useNotification();
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    void appConfigDir()
      .then((dir) => join(dir, "anidesk.db"))
      .then((value) => {
        if (active) setPath(value);
      })
      .catch((cause: unknown) => {
        console.error("Data path", cause);
        if (active) setPathError(true);
      });
    return () => {
      active = false;
    };
  }, []);
  async function changeTheme(value: Theme) {
    if (busy) return;
    if (!isTauri()) {
      setError("Сохранение темы доступно в приложении AnimDesk для Windows.");
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await saveTheme(value);
    setBusy(false);
    if (result.ok) {
      setTheme(value);
      notify("Тема сохранена", "success");
    } else {
      applyTheme(theme);
      setError(result.error.message);
    }
  }
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="space-y-6">
        <section className="surface">
          <h2 className="font-semibold">Локальный профиль</h2>
          <Link
            to="/profile"
            className="mt-3 inline-block text-violet-bright underline underline-offset-4"
          >
            Редактировать имя профиля
          </Link>
        </section>
        <section className="surface">
          <h2 className="font-semibold">Внешний вид</h2>
          <label className="mt-5 flex flex-wrap items-center justify-between gap-4 text-sm">
            Тема оформления
            <select
              className="field"
              value={theme}
              disabled={busy}
              onChange={(e) => {
                void changeTheme(e.target.value as Theme);
              }}
            >
              <option value="dark">Тёмная</option>
              <option value="light">Светлая</option>
            </select>
          </label>
          {busy && (
            <p role="status" className="mt-3 text-sm">
              Сохраняем тему…
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
          <p className="mt-5 text-sm text-zinc-400">Язык интерфейса: русский</p>
        </section>
        <TransferPanel />
        <section className="surface">
          <h2 className="font-semibold">AnimDesk {version}</h2>
          <p className="mt-3 text-sm text-zinc-400">
            Личная библиотека аниме для Windows 10/11.
          </p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div>
              <dt className="text-zinc-400">Основной источник метаданных</dt>
              <dd>Shikimori GraphQL</dd>
            </div>
            <div>
              <dt className="text-zinc-400">Файл локальных данных SQLite</dt>
              <dd className="mt-1 select-text break-all">
                {path ??
                  (isTauri() && !pathError
                    ? "Определяем путь…"
                    : "%APPDATA%\\app.anidesk.desktop\\anidesk.db")}
              </dd>
            </div>
          </dl>
          {pathError && (
            <p role="status" className="mt-3 text-sm text-amber-200">
              Не удалось определить полный путь. Выше указан стандартный путь
              Windows.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
