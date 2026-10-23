import { Link } from "react-router-dom";
import { AnimeCover } from "./AnimeCover";
import { formatLabel, type CatalogAnime } from "../services/catalog/types";

export function RelatedAnime({ items }: { items: CatalogAnime["related"] }) {
  if (!items.length) return null;
  return (
    <section
      className="mt-8 border-t border-amber-200/10 pt-6"
      aria-labelledby="related-heading"
    >
      <h2
        id="related-heading"
        className="mb-4 text-2xl font-semibold text-amber-100"
      >
        Связанное
      </h2>
      <ul className="grid gap-3 xl:grid-cols-2">
        {items.map((item) => (
          <li key={`${item.provider}:${item.providerId}`}>
            <Link
              className="related-anime-card group block rounded-xl border border-amber-200/10 bg-amber-100/[0.025] p-3 transition-colors hover:border-amber-200/30 hover:bg-amber-100/[0.06]"
              to={`/anime/${item.provider}/${encodeURIComponent(item.providerId)}`}
            >
              <h3 className="mb-2 font-medium text-stone-100 group-hover:text-amber-100">
                {item.title}
              </h3>
              <div className="flex gap-3">
                <AnimeCover
                  url={item.coverUrl ?? null}
                  title={item.title}
                  className="related-anime-cover w-14 shrink-0 rounded-lg object-cover"
                />
                <div className="space-y-1 py-1 text-sm">
                  <p className="text-stone-300">
                    {item.format ? formatLabel(item.format) : "Тип неизвестен"}{" "}
                    / {item.year ?? "Год неизвестен"}
                  </p>
                  <p className="text-amber-200/85">{item.relation}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
