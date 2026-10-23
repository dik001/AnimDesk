import type { LibraryStatus } from "../../types/anime";
import type { LibraryRecord } from "../../types/storage";
export type LibrarySort = "added" | "updated" | "title" | "year";
export function filterLibrary(
  items: LibraryRecord[],
  status: LibraryStatus | "all",
  query: string,
  sort: LibrarySort,
) {
  const needle = query.trim().toLocaleLowerCase("ru");
  return items
    .filter(
      (e) =>
        (status === "all" || e.status === status) &&
        [e.anime.title, ...e.anime.titles.map((t) => t.title)].some((t) =>
          t.toLocaleLowerCase("ru").includes(needle),
        ),
    )
    .sort((a, b) => {
      const byTitle = a.anime.title.localeCompare(b.anime.title, "ru");
      if (sort === "title") return byTitle;
      if (sort === "year")
        return (b.anime.year ?? -1) - (a.anime.year ?? -1) || byTitle;
      return (
        (sort === "added"
          ? b.addedAt.localeCompare(a.addedAt)
          : b.updatedAt.localeCompare(a.updatedAt)) || byTitle
      );
    });
}
