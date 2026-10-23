import { Star } from "lucide-react";
import { useEffect, useRef, useState, useId, type CSSProperties } from "react";
import { ratingRepository } from "../../repositories/ratingRepository";
import { LOCAL_PROFILE_ID } from "../../types/storage";
import { LIBRARY_CHANGED } from "./events";

export function PersonalRating({ animeId }: { animeId: number | null }) {
  const [state, setState] = useState<{
    id: number | null;
    value?: number | null;
    error?: string;
  }>({ id: animeId });
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number>();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    let active = true;
    const load = async () => {
      const token = ++request.current;
      if (animeId === null) return;
      const result = await ratingRepository.get(LOCAL_PROFILE_ID, animeId);
      if (!active || token !== request.current) return;
      if (result.ok) setState({ id: animeId, value: result.data });
      else {
        console.error("Rating read", result.error);
        setState({ id: animeId, error: result.error.message });
      }
    };
    const refresh = () => {
      void load();
    };
    refresh();
    window.addEventListener(LIBRARY_CHANGED, refresh);
    return () => {
      active = false;
      window.removeEventListener(LIBRARY_CHANGED, refresh);
    };
  }, [animeId, revision]);
  const reveal = () => {
    const trigger = root.current?.querySelector<HTMLButtonElement>(
      ".personal-rating-trigger",
    );
    if (trigger)
      root.current?.style.setProperty(
        "--rating-origin",
        `${trigger.offsetWidth}px`,
      );
    setOpen(true);
  };
  const value = state.id === animeId ? state.value : undefined;
  async function rate(rating: number | null) {
    if (lock.current || animeId === null) return;
    lock.current = true;
    setBusy(true);
    const token = ++request.current;
    try {
      const result = await ratingRepository.set(
        LOCAL_PROFILE_ID,
        animeId,
        rating,
      );
      if (result.ok) {
        setState({ id: animeId, value: result.data });
        setOpen(false);
        root.current
          ?.querySelector<HTMLButtonElement>(".personal-rating-trigger")
          ?.focus();
      } else {
        console.error("Rating write", result.error);
        setState({ id: animeId, value, error: result.error.message });
      }
    } catch (cause) {
      console.error("Rating write", cause);
      if (token === request.current)
        setState({
          id: animeId,
          value,
          error: "Не удалось сохранить вашу оценку.",
        });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div
      ref={root}
      className="personal-rating mb-4"
      onMouseEnter={reveal}
      onMouseLeave={() => {
        if (!root.current?.contains(document.activeElement)) setOpen(false);
        setHover(undefined);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setHover(undefined);
        }
      }}
    >
      <button
        type="button"
        className="personal-rating-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={animeId === null || busy}
        onClick={reveal}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            reveal();
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLButtonElement>(".rating-star")
                ?.focus(),
            );
          }
        }}
      >
        <Star
          aria-hidden="true"
          className="size-7 shrink-0"
          fill={value ? "currentColor" : "none"}
        />
        <span>{value ? `Ваша оценка: ${value}` : "Оценить аниме"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="personal-rating-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            event.preventDefault();
            setOpen(false);
            root.current
              ?.querySelector<HTMLButtonElement>(".personal-rating-trigger")
              ?.focus();
          }
        }}
      >
        <div
          className="flex flex-wrap items-center gap-0.5"
          role="group"
          aria-label="Ваша оценка от 1 до 10"
          onMouseLeave={() => setHover(undefined)}
        >
          {Array.from({ length: 10 }, (_, index) => index + 1).map((rating) => (
            <button
              key={rating}
              style={
                {
                  "--star-index": rating - 1,
                  animationDelay: `${(rating - 1) * 32}ms`,
                } as CSSProperties
              }
              type="button"
              className={`rating-star ${(hover ?? value ?? 0) >= rating ? "is-filled" : ""}`}
              aria-label={`Оценить на ${rating} из 10`}
              aria-pressed={value === rating}
              disabled={busy || value === undefined}
              onMouseEnter={() => setHover(rating)}
              onFocus={() => setHover(rating)}
              onClick={() => {
                void rate(rating);
              }}
            >
              <Star aria-hidden="true" className="size-6" />
            </button>
          ))}
        </div>

        {value !== null && value !== undefined && (
          <button
            type="button"
            disabled={busy}
            className="ml-2 self-center whitespace-nowrap text-xs text-amber-200 underline"
            onClick={() => {
              void rate(null);
            }}
          >
            Снять оценку
          </button>
        )}
      </div>
      {busy && (
        <p role="status" className="mt-1 text-xs text-stone-400">
          Сохранение оценки…
        </p>
      )}
      {state.id === animeId && state.error && (
        <p role="alert" className="mt-2 text-sm text-rose-300">
          {state.error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setRevision((n) => n + 1)}
          >
            Повторить
          </button>
        </p>
      )}
    </div>
  );
}
