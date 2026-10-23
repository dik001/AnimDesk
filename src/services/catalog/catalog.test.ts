import { fromStored, toUpsertInput } from "./storage";
/* eslint @typescript-eslint/require-await: "off" -- Mock transports implement an async contract without real I/O. */
import { describe, expect, it, vi } from "vitest";
import {
  coverUrl,
  jikanPage,
  mapJikan,
  mapShikimori,
  shikimoriPage,
  text,
} from "./mappers";
import { ShikimoriProvider } from "./providers";
import { CatalogService, type CatalogStore } from "./service";
import {
  CatalogError,
  currentSeason,
  type CatalogAnime,
  type CatalogTransport,
} from "./types";
import type { StoredAnime } from "../../types/storage";

const shiki = {
  id: "100",
  malId: "1535",
  name: "Death Note",
  russian: "Тетрадь смерти",
  english: "Death Note",
  episodes: 37,
  airedOn: { year: 2006 },
  description: "<b>Описание</b> [i]истории[/i]",
  poster: { mainUrl: "/system/animes/100.jpg" },
};
const jikan = {
  mal_id: 1535,
  title: "Death Note",
  title_english: "Death Note",
  episodes: 37,
  year: 2006,
  synopsis: "English synopsis",
};
const gql = (items: unknown[] = [shiki]) => ({ data: { animes: items } });
const rest = (items: unknown[] = [jikan], next = false) => ({
  data: items,
  pagination: { has_next_page: next },
});
function storage(): CatalogStore {
  return {
    find: vi.fn(async () => null),
    save: vi.fn(async (a: CatalogAnime) => ({
      ...a,
      id: 7,
      coverCachePath: null,
      episodesTotal: a.episodeCount,
      communityScore: a.score,
      fetchedAt: "2026-01-01",
    })),
  };
}
function service(transport: CatalogTransport, store = storage()) {
  return new CatalogService(
    new ShikimoriProvider(transport),
    store,
  );
}

describe("защитные мапперы", () => {
  it("приоритет русского, разные внешние ID и безопасное описание", () => {
    const a = mapShikimori(shiki);
    expect(a.title).toBe("Тетрадь смерти");
    expect(a.providerId).toBe("100");
    expect(a.malId).toBe(1535);
    expect(a.synopsis).toBe("Описание истории");
    expect(a.coverUrl).toBe("https://shikimori.io/system/animes/100.jpg");
    expect(a.titles).toContainEqual({
      language: "ru",
      title: "Тетрадь смерти",
    });
  });
  it.each([null, undefined, "", "  "])(
    "нет русского (%s), без машинного перевода",
    (russian) => {
      expect(mapShikimori({ ...shiki, russian }).title).toBe("Death Note");
    },
  );
  it.each([null, undefined, "", 0, -1, "37"])(
    "неизвестное число серий (%s)",
    (episodes) => {
      expect(mapShikimori({ ...shiki, episodes }).episodeCount).toBeNull();
      expect(mapJikan({ ...jikan, episodes }).episodeCount).toBeNull();
    },
  );
  it("отсутствующие необязательные объекты", () => {
    const a = mapShikimori({ id: 1, name: "A" });
    expect(a.coverUrl).toBeNull();
    expect(a.year).toBeNull();
    expect(a.genres).toEqual([]);
    expect(a.malId).toBeNull();
    const b = mapJikan({ mal_id: 1, title: "B" });
    expect(b.provider).toBe("jikan");
    expect(b.shikimoriId).toBeNull();
  });
  it.each([null, {}, { id: "abc", name: "A" }, { id: 1 }])(
    "некорректная сущность — ошибка",
    (value) => {
      expect(() => mapShikimori(value)).toThrow(CatalogError);
    },
  );
  it("произвольные/небезопасные обложки отбрасываются", () => {
    for (const url of [
      "https://evil.example/a",
      "http://shikimori.one/a",
      "https://shikimori.one.evil.example/a",
      "https://u:p@shikimori.one/a",
      "javascript:alert(1)",
      "//evil.example/a",
    ]) {
      expect(coverUrl(url, "shikimori")).toBeNull();
    }
  });
  it("Jikan titles с известным языком", () => {
    const a = mapJikan({
      ...jikan,
      titles: [
        { type: "Japanese", title: "デスノート" },
        { type: "English", title: "Death Note" },
      ],
      images: null,
    });
    expect(a.titles[0]?.language).toBe("ja");
    expect(a.synopsis).toBe("English synopsis");
  });
  it("plain text очищает HTML, BBCode и entities", () => {
    expect(
      text(
        "<script>alert(1)</script><p>A &amp; B</p><br>[url=https://evil]C[/url]",
      ),
    ).toBe("A & B\nC");
  });
  it("GraphQL errors с HTTP 200 и частичными data не скрываются", () => {
    expect(() =>
      shikimoriPage({ ...gql(), errors: [{ message: "Bad query" }] }, 1),
    ).toThrow(CatalogError);
    expect(() => shikimoriPage({ data: null }, 1)).toThrow(CatalogError);
  });
  it("пагинация Shikimori по полной странице, Jikan по флагу", () => {
    expect(
      shikimoriPage(gql(Array.from({ length: 20 }, () => shiki)), 3),
    ).toMatchObject({ page: 3, hasNextPage: true });
    expect(shikimoriPage(gql([]), 4).hasNextPage).toBe(false);
    expect(jikanPage(rest([], true), 2).hasNextPage).toBe(true);
    expect(() => jikanPage({ data: [] }, 1)).toThrow(CatalogError);
  });
  it.each([
    [0, "winter"],
    [2, "winter"],
    [3, "spring"],
    [5, "spring"],
    [6, "summer"],
    [8, "summer"],
    [9, "fall"],
    [11, "fall"],
  ])("сезон месяца %i", (month, name) => {
    expect(currentSeason(new Date(2031, month, 1))).toBe(`${name}_2031`);
  });
});
describe("выбор источника и идентичность с mock transport", () => {
  it("успешный поиск не вызывает Jikan, параметры передаются явно", async () => {
    const transport = vi.fn<CatalogTransport>().mockResolvedValue(gql());
    const s = service(transport);
    const result = await s.searchAnime("Death Note", 2, {
      year: 2006,
      kind: "tv",
    });
    expect(result.source).toBe("shikimori");
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]?.[0]).toMatchObject({
      page: 2,
      year: 2006,
      kind: "tv",
      query: "Death Note",
    });
  });
  it("GraphQL failure не вызывает другой каталог, включая следующую страницу", async () => {
    const transport = vi.fn<CatalogTransport>().mockResolvedValue({ errors: [{ message: "fail" }] });
    const s = service(transport);
    await expect(s.searchAnime("Death Note")).rejects.toMatchObject({ code: "graphql" });
    await expect(s.searchAnime("Death Note", 2)).rejects.toMatchObject({ code: "graphql" });
    expect(transport.mock.calls.every(([r]) => r.provider === "shikimori")).toBe(true);
  });
  it("429, network и timeout сохраняют исходную причину без резервных запросов", async () => {
    for (const code of ["rate_limit", "network", "timeout"]) {
      const transport = vi.fn<CatalogTransport>().mockRejectedValue(new CatalogError(code, "Ошибка", "diagnostic", 30));
      await expect(service(transport).getTopAnime()).rejects.toMatchObject({ code, detail: "diagnostic", retryAfterSeconds: 30 });
      expect(transport).toHaveBeenCalledOnce();
    }
  });
  it("пустая успешная выдача не запускает резерв", async () => {
    const transport = vi.fn<CatalogTransport>().mockResolvedValue(gql([]));
    expect((await service(transport).searchAnime("absent")).data.items).toEqual(
      [],
    );
    expect(transport).toHaveBeenCalledOnce();
  });
  it("известный MAL ID не разрешает запрос другого каталога", async () => {
    const transport = vi.fn<CatalogTransport>(async (r) => {
      if (r.operation === "search") return gql();
      throw new CatalogError("network", "Нет связи");
    });
    const s = service(transport);
    await s.searchAnime("Death Note");
    await expect(s.getAnimeById("shikimori", "100")).rejects.toMatchObject({ code: "network" });
    expect(transport.mock.calls.every(([r]) => r.provider === "shikimori")).toBe(true);
  });
  it("неизвестный MAL ID — явная ошибка без поиска похожего названия", async () => {
    const transport = vi
      .fn<CatalogTransport>()
      .mockRejectedValue(new TypeError("offline"));
    await expect(
      service(transport).getAnimeById("shikimori", "100"),
    ).rejects.toMatchObject({ code: "network" });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("локальная карточка остаётся доступной офлайн", async () => {
    const store = storage();
    vi.mocked(store.find).mockResolvedValue({
      ...mapShikimori(shiki),
      id: 7,
      provider: "shikimori",
      coverCachePath: null,
      episodesTotal: 37,
      communityScore: 8,
      fetchedAt: "2026",
    } satisfies StoredAnime);
    const result = await service(async () => {
      throw new TypeError("offline");
    }, store).getAnimeById("shikimori", "100");
    expect(result.cached).toBe(true);
    expect(result.data.id).toBe(7);
    expect(result.data.title).toBe("Тетрадь смерти");
    expect(store.save).not.toHaveBeenCalled();
  });
  it("неподходящий Shikimori ID из details отвергается", async () => {
    await expect(new ShikimoriProvider(async () => gql([{ ...shiki, id: "9" }])).getAnimeById("shikimori", "100"))
      .rejects.toMatchObject({ code: "not_found" });
  });
  it("конфликт локальных ID не скрывается кешем или резервом", async () => {
    const store = storage();
    vi.mocked(store.save).mockRejectedValue(
      new CatalogError("identity_conflict", "Конфликт"),
    );
    await expect(
      service(async () => gql(), store).getAnimeById("shikimori", "100"),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });
  it("кеш предотвращает повторный запрос", async () => {
    const t = vi.fn<CatalogTransport>().mockResolvedValue(gql());
    const s = service(t);
    await s.getTopAnime();
    expect((await s.getTopAnime()).cached).toBe(true);
    expect(t).toHaveBeenCalledOnce();
  });
  it("устаревший ответ игнорируется, не кешируется и не запускает резерв", async () => {
    let resolve!: (v: unknown) => void;
    const t = vi.fn<CatalogTransport>(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const s = service(t);
    const controller = new AbortController();
    const pending = s.searchAnime("old", 1, {}, controller.signal);
    controller.abort();
    resolve(gql());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(t).toHaveBeenCalledOnce();
  });
  it("устаревшие details не записываются в SQLite", async () => {
    const store = storage();
    const c = new AbortController();
    const s = service(async () => {
      c.abort();
      return gql();
    }, store);
    await expect(
      s.getAnimeById("shikimori", "100", c.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.save).not.toHaveBeenCalled();
  });
  it("жанр сопоставляется по словарям, IDs разных API не смешиваются", async () => {
    const t = vi.fn<CatalogTransport>(async (r) =>
      r.operation === "genres"
        ? r.provider === "shikimori"
          ? {
              data: { genres: [{ id: "99", name: "Drama", russian: "Драма" }] },
            }
          : { data: [{ mal_id: 8, name: "Drama" }] }
        : r.provider === "shikimori"
          ? gql()
          : rest(),
    );
    await new ShikimoriProvider(t).searchAnime("A", 1, { genre: "Drama" });
    expect(t.mock.calls.map(([r]) => r)).toContainEqual(expect.objectContaining({ provider: "shikimori", operation: "search", genre: "99" }));
  });
});

describe("сохранение качества метаданных", () => {
  it("Jikan сохраняет русские название, описание и альтернативные названия", () => {
    const existing: StoredAnime = {
      ...mapShikimori(shiki),
      id: 7,
      coverCachePath: null,
      episodesTotal: 37,
      communityScore: 8,
      fetchedAt: "2026",
    };
    const input = toUpsertInput(mapJikan(jikan), existing);
    expect(input.title).toBe("Тетрадь смерти");
    expect(input.synopsis).toBe("Описание истории");
    expect(input.titles).toContainEqual({
      language: "ru",
      title: "Тетрадь смерти",
    });
  });
  it("сохраняет описание Shikimori даже без русского названия", () => {
    const existing: StoredAnime = {
      ...mapShikimori({ ...shiki, russian: null }),
      id: 7,
      coverCachePath: null,
      episodesTotal: 37,
      communityScore: 8,
      fetchedAt: "2026",
    };
    expect(toUpsertInput(mapJikan(jikan), existing).synopsis).toBe(
      "Описание истории",
    );
  });
});

it("неподдерживаемый резервом жанр показан как ошибка фильтра, без неотфильтрованных результатов", async () => {
  const s = service(async (r) => {
    if (r.operation === "genres")
      return { data: { genres: [{ id: "8", name: "Drama" }] } };
    throw new Error("Search must not run without a valid genre ID");
  });
  await expect(
    s.searchAnime("A", 1, { genre: "Unknown genre" }),
  ).rejects.toMatchObject({ code: "unsupported_filter" });
});

it("локальная запись с исходной парой Jikan сохраняет доверенную обложку после обогащения Shikimori", () => {
  const a: StoredAnime = {
    ...mapShikimori(shiki),
    provider: "jikan",
    providerId: "1535",
    id: 7,
    coverCachePath: null,
    episodesTotal: 37,
    communityScore: 8,
    fetchedAt: "2026",
  };
  expect(fromStored(a).coverUrl).toBe(
    "https://shikimori.io/system/animes/100.jpg",
  );
  expect(
    fromStored({ ...a, coverUrl: "https://evil.example/a" }).coverUrl,
  ).toBeNull();
});

it("закрытый публичный резерв показан явно, без обещания повторить позже", async () => {
  const s = service((r) =>
    r.provider === "shikimori"
      ? Promise.reject(new TypeError("offline"))
      : Promise.reject(
          new CatalogError(
            "service_discontinued",
            "Источник метаданных недоступен.",
          ),
        ),
  );
  const error: unknown = await s.getTopAnime().catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(CatalogError);
  if (error instanceof CatalogError) {
    expect(error.code).toBe("network");
    expect(error.detail).toBeInstanceOf(TypeError);
  }
});
it("локальная карточка публикуется до ответа сети; сбой не вызывает запись", async () => {
  const store = storage();
  const saved: StoredAnime = {
    ...mapShikimori(shiki),
    id: 7,
    coverCachePath: null,
    episodesTotal: 37,
    communityScore: 8,
    fetchedAt: "2026",
    metadataJson: JSON.stringify({
      status: "released",
      related: [
        {
          provider: "shikimori",
          providerId: "200",
          title: "Сезон 2",
          relation: "Продолжение",
        },
      ],
    }),
  };
  store.find = vi.fn(async () => saved);
  let reject!: (e: Error) => void;
  const transport = vi.fn<CatalogTransport>(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const s = service(transport, store);
  const publish = vi.fn();
  const pending = s.getAnimeById("shikimori", "100", undefined, publish);
  await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
  expect(publish.mock.calls[0]?.[0]).toMatchObject({
    data: {
      title: "Тетрадь смерти",
      status: "released",
      related: [{ providerId: "200" }],
    },
  });
  reject(new Error("offline"));
  expect(transport).toHaveBeenCalledOnce();
  const result = await pending;
  expect(result.data.id).toBe(7);
  expect(store.save).not.toHaveBeenCalled();
});

it("локальный маршрут Jikan обновляется через известный Shikimori ID", async () => {
  const store = storage();
  store.find = vi.fn(async () => ({
    ...mapShikimori(shiki),
    provider: "jikan",
    providerId: "1535",
    id: 7,
    coverCachePath: null,
    episodesTotal: 37,
    communityScore: 8,
    fetchedAt: "2026",
  }));
  const transport = vi.fn<CatalogTransport>().mockResolvedValue(gql());
  await service(transport, store).getAnimeById("jikan", "1535");
  expect(transport).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "shikimori", id: "100" }),
    undefined,
  );
});

it("отсутствующие поля не стирают сохранённые метаданные и русское название", () => {
  const existing: StoredAnime = {
    ...mapShikimori(shiki),
    id: 7,
    coverCachePath: null,
    episodesTotal: 37,
    communityScore: 8,
    fetchedAt: "2026",
    metadataJson: JSON.stringify({ status: "released", related: [] }),
  };
  const input = toUpsertInput(
    mapShikimori({ id: "100", name: "Death Note" }),
    existing,
  );
  expect(input).toMatchObject({
    title: "Тетрадь смерти",
    synopsis: "Описание истории",
    episodesTotal: 37,
    year: 2006,
    communityScore: 8,
  });
  expect(fromStored({ ...existing, ...input }).status).toBe("released");
});
