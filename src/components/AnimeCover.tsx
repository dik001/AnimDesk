import { useState } from "react";
import { useCachedCover } from "../features/localMedia";
import { ImageOff } from "lucide-react";
export function AnimeCover({
  url,
  title,
  className = "",
}: {
  url: string | null;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const image = useCachedCover(url);
  return image && image !== failed ? (
    <img
      src={image}
      alt={`Обложка «${title}»`}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={className}
      onError={() => setFailed(image)}
    />
  ) : (
    <div
      className={`${className} grid min-h-32 place-items-center bg-ink-850 text-zinc-400`}
    >
      <ImageOff aria-hidden="true" className="size-7" />
      <span className="sr-only">Обложка недоступна</span>
    </div>
  );
}
