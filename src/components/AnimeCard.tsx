import { CommunityScore } from "./CommunityScore";
import { AnimeCover } from "./AnimeCover";
import { Link } from "react-router-dom";
import { formatLabel, type CatalogAnime } from "../services/catalog/types";

export function AnimeCard({ anime }: { anime: CatalogAnime }) {
  return (
    <article className="group min-w-0">
      <Link
        className="block"
        to={`/anime/${encodeURIComponent(anime.provider)}/${encodeURIComponent(anime.providerId)}`}
      >
        <div className="aspect-[2/3] overflow-hidden rounded-2xl border border-white/[0.07] bg-ink-800 shadow-lg shadow-black/10 transition duration-200 group-hover:-translate-y-1 group-hover:border-violet-accent/30 group-hover:shadow-black/25">
          <AnimeCover
            url={anime.coverUrl}
            title={anime.title}
            className="h-full w-full object-cover"
          />
        </div>
        <h3 className="mt-3 truncate text-sm font-medium text-zinc-200 transition group-hover:text-white">
          {anime.title}
        </h3>
        <p className="mt-1 text-xs text-zinc-500">
          {anime.year ?? "Год не указан"} · {formatLabel(anime.format)} ·{" "}
          <CommunityScore score={anime.score} />
        </p>
      </Link>
    </article>
  );
}
