import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { profileRepository } from "../repositories/profileRepository";
import { libraryRepository } from "../repositories/libraryRepository";
import { LOCAL_PROFILE_ID, type Profile } from "../types/storage";
import { LIBRARY_STATUSES, LIBRARY_STATUS_LABELS } from "../types/anime";
import { LIBRARY_CHANGED } from "../features/library/events";
import { useLocalQuery } from "../features/useLocalQuery";
import { useNotification } from "../features/notifications/useNotification";

function ProfileEditor({ profile }: { profile: Profile }) {
  const [avatar, setAvatar] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (isTauri())
      void invoke<string | null>("avatar_image")
        .then((value) => {
          if (active) setAvatar(value);
        })
        .catch((cause) => console.error("Avatar", cause));
    return () => {
      active = false;
    };
  }, []);
  async function changeAvatar(reset: boolean) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (!isTauri())
        throw new Error(
          "Выбор аватара доступен в приложении AnimDesk для Windows.",
        );
      if (reset) {
        await invoke("reset_avatar");
        setAvatar(null);
      } else {
        const value = await invoke<string | null>("choose_avatar");
        if (value) setAvatar(value);
      }
    } catch (cause) {
      console.error("Avatar", cause);
      setError(`Не удалось изменить аватар: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }
  const [name, setName] = useState(profile.displayName);
  const [saved, setSaved] = useState(profile.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { notify } = useNotification();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const result = await profileRepository.updateDisplayName(name);
    setBusy(false);
    if (result.ok) {
      setName(result.data.displayName);
      setSaved(result.data.displayName);
      notify("Имя профиля сохранено", "success");
    } else {
      console.error("Profile name", result.error);
      setError(result.error.message);
    }
  }
  return (
    <section className="surface mb-8 flex flex-wrap items-start gap-5">
      {avatar ? (
        <img
          src={avatar}
          alt="Аватар профиля"
          className="size-16 rounded-2xl object-cover"
          onError={() => setAvatar(null)}
        />
      ) : (
        <span
          role="img"
          aria-label="Стандартный аватар"
          className="grid size-16 shrink-0 place-items-center rounded-2xl bg-violet-accent/15 text-violet-bright"
        >
          <UserRound aria-hidden="true" className="size-8" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-lg font-semibold">{saved}</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Создан{" "}
          {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(
            new Date(profile.createdAt),
          )}
        </p>
        <form
          onSubmit={(e) => {
            void submit(e);
          }}
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          <label className="grid min-w-0 gap-2 text-sm">
            Имя профиля
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              aria-describedby={error ? "profile-error" : undefined}
            />
          </label>
          <button
            className="primary-button"
            disabled={busy || !name.trim() || name.trim() === saved}
          >
            {busy ? "Сохраняем…" : "Сохранить имя"}
          </button>
        </form>
        {error && (
          <p id="profile-error" role="alert" className="mt-3 text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="field"
            disabled={busy}
            onClick={() => void changeAvatar(false)}
          >
            Выбрать аватар
          </button>
          <button
            className="field"
            disabled={busy}
            onClick={() => void changeAvatar(true)}
          >
            Сбросить аватар
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          PNG, JPEG или WebP · до 5 МБ
        </p>
      </div>
    </section>
  );
}
export default function ProfilePage() {
  const profile = useLocalQuery(() => profileRepository.getDefault());
  const stats = useLocalQuery(
    () => libraryRepository.getStatistics(LOCAL_PROFILE_ID),
    LIBRARY_CHANGED,
  );
  const data = stats.data;
  const percent =
    data && data.totalEntries
      ? Math.round((data.byStatus.completed / data.totalEntries) * 100)
      : 0;
  return (
    <>
      <PageHeader title="Профиль" />
      {profile.error ? (
        <ErrorState message={profile.error} onRetry={profile.reload} />
      ) : profile.data ? (
        <ProfileEditor profile={profile.data} />
      ) : (
        <LoadingState label="Загрузка профиля…" />
      )}
      <section aria-labelledby="statistics-heading" className="mt-8">
        <h2 id="statistics-heading" className="mb-5 text-xl font-semibold">
          Ваша статистика
        </h2>
        {stats.error && (
          <ErrorState message={stats.error} onRetry={stats.reload} />
        )}
        {!data && !stats.error && <LoadingState label="Расчёт статистики…" />}
        {data && (
          <>
            <dl
              aria-label="Статистика библиотеки"
              aria-live="polite"
              className="grid grid-cols-2 gap-4 xl:grid-cols-4"
            >
              {[
                ["Всего аниме", data.totalEntries],
                ["Отмечено серий", data.totalWatchedEpisodes],
                ["Доля завершённых", `${percent}%`],
                ...LIBRARY_STATUSES.map((status) => [
                  LIBRARY_STATUS_LABELS[status],
                  data.byStatus[status],
                ]),
              ].map(([label, value]) => (
                <div key={label} className="surface">
                  <dt className="text-sm text-zinc-400">{label}</dt>
                  <dd className="mt-3 text-3xl font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </>
  );
}
