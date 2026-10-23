import { afterEach, expect, it, vi } from "vitest";
import { settingsRepository } from "../repositories/settingsRepository";
import { applyTheme, loadTheme, saveTheme } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function documentMock() {
  const element = {
    dataset: {} as Record<string, string>,
    style: { colorScheme: "" },
  };
  vi.stubGlobal("document", { documentElement: element });
  return element;
}
it("тёмная тема по умолчанию, светлая читается из SQLite", async () => {
  const el = documentMock();
  const get = vi
    .spyOn(settingsRepository, "get")
    .mockResolvedValue({ ok: true, data: null });
  await loadTheme();
  expect(el.dataset.theme).toBe("dark");
  get.mockResolvedValue({ ok: true, data: "light" });
  await loadTheme();
  expect(el.dataset.theme).toBe("light");
  expect(el.style.colorScheme).toBe("light");
});
it("тема меняется только после успешной записи, отказ сохраняет старую", async () => {
  const el = documentMock();
  applyTheme("dark");
  const set = vi
    .spyOn(settingsRepository, "set")
    .mockResolvedValue({
      ok: false,
      error: { code: "storage", message: "Ошибка записи" },
    });
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await saveTheme("light")).ok).toBe(false);
  expect(el.dataset.theme).toBe("dark");
  set.mockResolvedValue({ ok: true, data: undefined });
  expect((await saveTheme("light")).ok).toBe(true);
  expect(set).toHaveBeenLastCalledWith("theme", "light");
  expect(el.dataset.theme).toBe("light");
});
