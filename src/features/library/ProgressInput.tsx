import { useId } from "react";
import { controlClass } from "./controls";
export function ProgressInput({
  value,
  total,
  onChange,
  onCommit,
  disabled = false,
}: {
  value: string;
  total: number | null;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const number = Number(value);
  const step = (offset: number) => {
    const next = String(
      Math.max(0, (Number.isSafeInteger(number) ? number : 0) + offset),
    );
    onChange(next);
    onCommit?.(next);
  };
  return (
    <div>
      <label className="mb-2 block text-sm text-stone-300" htmlFor={id}>
        Просмотрено серий / {total ?? "Неизвестно"}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={controlClass}
          aria-label="Уменьшить прогресс"
          disabled={disabled || number <= 0}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(-1)}
        >
          −
        </button>
        <input
          id={id}
          className={`${controlClass} progress-input min-w-0 flex-1 text-center tabular-nums`}
          type="number"
          min="0"
          max={total ?? undefined}
          step="1"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onCommit?.(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onCommit) {
              e.preventDefault();
              onCommit(value);
            }
          }}
        />
        <button
          type="button"
          className={controlClass}
          aria-label="Увеличить прогресс"
          disabled={disabled || (total !== null && number >= total)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => step(1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
