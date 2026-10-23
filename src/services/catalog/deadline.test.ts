import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "./deadline";
import { CatalogService } from "./service";
import { catalogTransport } from "./transport";

const { nativeInvoke } = vi.hoisted(() => ({
  nativeInvoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: nativeInvoke,
}));
afterEach(() => {
  vi.useRealTimers();
  nativeInvoke.mockReset();
});

describe("ограничение всей операции", () => {
  it("незавершающийся promise получает timeout", async () => {
    vi.useFakeTimers();
    const pending = withDeadline(() => new Promise<unknown>(() => {}), 100);
    const outcome = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("успех освобождает таймер", async () => {
    vi.useFakeTimers();
    expect(await withDeadline(() => Promise.resolve(42), 100)).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("отмена немедленно завершает ожидание зависшего вызова", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = withDeadline(
      () => new Promise<unknown>(() => {}),
      100,
      controller.signal,
    );
    const outcome = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await outcome;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("поздний результат не меняет timeout", async () => {
    vi.useFakeTimers();
    let resolve!: (value: number) => void;
    const success = vi.fn();
    const pending = withDeadline(
      () =>
        new Promise<number>((r) => {
          resolve = r;
        }),
      100,
    ).then(success);
    const outcome = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    resolve(42);
    await Promise.resolve();
    expect(success).not.toHaveBeenCalled();
  });
  it("синхронное исключение loader также становится ошибкой", async () => {
    await expect(
      withDeadline(() => {
        throw new Error("sync failure");
      }, 100),
    ).rejects.toThrow("sync failure");
  });
  it("нативный IPC ограничен 14 секундами", async () => {
    vi.useFakeTimers();
    nativeInvoke.mockImplementation(() => new Promise<unknown>(() => {}));
    const pending = catalogTransport({
      provider: "shikimori",
      operation: "top",
    });
    const outcome = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(14_000);
    await outcome;
    expect(nativeInvoke).toHaveBeenCalledOnce();
  });
  it("зависший Shikimori завершается timeout без другого каталога", async () => {
    vi.useFakeTimers();
    nativeInvoke.mockImplementation((_command, args) => {
      const request = (args as { request: { provider: string } }).request;
      return request.provider === "shikimori"
        ? new Promise<unknown>(() => {})
        : Promise.resolve({
            data: [{ mal_id: 1535, title: "Death Note" }],
            pagination: { has_next_page: false },
          });
    });
    const pending = new CatalogService().getTopAnime();
    const outcome = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(14_000);
    await outcome;
    expect(nativeInvoke).toHaveBeenCalledOnce();
  });
});
