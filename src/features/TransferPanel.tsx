import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { libraryChanged } from "./library/events";
import { Modal } from "../components/Modal";
interface Preview {
  token: string;
  animeCount: number;
  entryCount: number;
  ratingCount: number;
  profileName: string;
}
export function TransferPanel() {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [mode, setMode] = useState("merge");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  useEffect(
    () => () => {
      if (preview)
        void invoke("cancel_import", { token: preview.token }).catch(
          console.error,
        );
    },
    [preview],
  );
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      if (!isTauri())
        throw new Error(
          "Перенос данных доступен в приложении AnimDesk для Windows.",
        );
      await action();
    } catch (cause) {
      console.error("Library transfer", cause);
      setError(`Не удалось перенести библиотеку: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface">
      <h2 className="font-semibold">Перенос данных</h2>
      <p className="mt-2 text-sm text-zinc-400">
        JSON переносит библиотеку, имя профиля и личные оценки. Аватар и кеш
        обложек остаются на этом компьютере.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          className="field"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const path = await invoke<string | null>("export_library");
              if (path) setMessage(`Библиотека сохранена: ${path}`);
            })
          }
        >
          Экспортировать библиотеку
        </button>
        <button
          className="field"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const value = await invoke<Preview | null>("preview_import");
              if (value) {
                setMode("merge");
                setConfirmed(false);
                setPreview(value);
              }
            })
          }
        >
          Импортировать библиотеку
        </button>
      </div>
      {busy && (
        <p role="status" className="mt-3">
          Обрабатываем данные…
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 break-all">
          {message}
        </p>
      )}
      {error && !preview && (
        <p role="alert" className="mt-3 text-red-300">
          {error}
        </p>
      )}
      {preview && (
        <Modal
          title="Импорт библиотеки"
          busy={busy}
          onClose={() => setPreview(undefined)}
        >
          <p>Профиль: {preview.profileName}</p>
          <p className="mt-2">
            Аниме: {preview.animeCount}. Записей библиотеки:{" "}
            {preview.entryCount}. Личных оценок: {preview.ratingCount}.
          </p>
          <label className="mt-5 grid gap-2">
            Режим импорта
            <select
              className="field"
              disabled={busy}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="merge">Объединить</option>
              <option value="replace">Заменить библиотеку</option>
            </select>
          </label>
          <p className="mt-3 text-sm text-zinc-400">
            {mode === "merge"
              ? "Новые записи будут добавлены. Для совпавших ID статус, прогресс, заметки и даты будут взяты из файла; импортированные оценки заменят прежние. Оценки, отсутствующие в файле, сохранятся."
              : "Текущие записи и оценки будут заменены. Перед заменой приложение сохранит защитный JSON в своём каталоге backups. Если резервную копию создать не удастся, замена не начнётся."}{" "}
            Имя профиля будет взято из файла.
          </p>
          <label className="mt-5 flex items-start gap-3">
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {mode === "replace"
              ? "Подтверждаю замену текущей библиотеки"
              : "Подтверждаю объединение и обновление совпавших записей"}
          </label>
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
          <div className="mt-5 flex gap-3">
            <button
              className="field"
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              Отмена
            </button>
            <button
              className="primary-button"
              disabled={busy || !confirmed}
              onClick={() =>
                void run(async () => {
                  const backup = await invoke<string | null>("apply_import", {
                    token: preview.token,
                    mode,
                    confirmed,
                  });
                  setPreview(undefined);
                  libraryChanged();
                  setMessage(
                    `Библиотека импортирована.${backup ? ` Резервная копия: ${backup}` : ""}`,
                  );
                })
              }
            >
              Применить импорт
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
