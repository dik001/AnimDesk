import { Star } from "lucide-react";
export function CommunityScore({ score }: { score: number | null }) {
  return score === null ? (
    <span>Нет оценки</span>
  ) : (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-label={`Оценка: ${score}`}
    >
      <Star
        aria-hidden="true"
        className="size-3.5 fill-amber-300 text-amber-300"
      />
      {score}
    </span>
  );
}
