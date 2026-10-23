import { settingsRepository } from "../repositories/settingsRepository";

export type Theme = "dark" | "light";
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export async function loadTheme() {
  const result = await settingsRepository.get("theme");
  if (!result.ok)
    throw new Error(result.error.message, { cause: result.error.cause });
  applyTheme(result.data === "light" ? "light" : "dark");
}
export async function saveTheme(theme: Theme) {
  const result = await settingsRepository.set("theme", theme);
  if (result.ok) applyTheme(theme);
  else console.error("Theme", result.error);
  return result;
}
