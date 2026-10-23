import { LIBRARY_CHANGED } from "../features/library/events";
import { warmCovers } from "../features/localMedia";
import { isTauri } from "@tauri-apps/api/core";
import { profileRepository } from "../repositories/profileRepository";
import { getDatabase } from "./client";

let initialization: Promise<void> | undefined;

export function initializeDatabase(): Promise<void> {
  if (!isTauri()) {
    return Promise.resolve();
  }

  initialization ??= initialize();
  return initialization;
}

async function initialize(): Promise<void> {
  await getDatabase();
  window.addEventListener(LIBRARY_CHANGED, warmCovers);
  window.addEventListener("online", warmCovers);
  warmCovers();
  const profile = await profileRepository.ensureDefault();

  if (!profile.ok) {
    throw profile.error.cause instanceof Error
      ? profile.error.cause
      : new Error(profile.error.message, { cause: profile.error.cause });
  }
}
