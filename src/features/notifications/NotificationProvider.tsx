import { useCallback, useMemo, useState, type PropsWithChildren } from "react";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { NotificationContext } from "./NotificationContext";
import type { AppNotification, NotificationTone } from "./notificationTypes";

const toneStyles: Readonly<Record<NotificationTone, string>> = {
  info: "border-violet-accent/30 bg-ink-750",
  success: "border-emerald-400/30 bg-ink-750",
  error: "border-rose-400/30 bg-ink-750",
};

const toneIcons = {
  info: Info,
  success: CircleCheck,
  error: CircleX,
} satisfies Record<NotificationTone, typeof Info>;

export function NotificationProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const dismiss = useCallback((id: string) => {
    setNotifications((items) => items.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, tone: NotificationTone = "info") => {
      const id = crypto.randomUUID();
      setNotifications((items) => [...items, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <aside
        aria-label="Уведомления"
        aria-live="polite"
        className="pointer-events-none fixed right-6 bottom-6 z-50 flex w-[min(380px,calc(100vw-3rem))] flex-col gap-3"
      >
        {notifications.map((notification) => {
          const Icon = toneIcons[notification.tone];
          return (
            <div
              className={`toast-enter pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-2xl shadow-black/30 ${toneStyles[notification.tone]}`}
              key={notification.id}
              role={notification.tone === "error" ? "alert" : "status"}
            >
              <Icon
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-violet-bright"
              />
              <p className="min-w-0 flex-1 text-sm leading-5 text-zinc-100">
                {notification.message}
              </p>
              <button
                aria-label="Закрыть уведомление"
                className="rounded-md p-1 text-zinc-400 transition hover:bg-white/5 hover:text-white"
                onClick={() => dismiss(notification.id)}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          );
        })}
      </aside>
    </NotificationContext.Provider>
  );
}
