import fs from "node:fs/promises";
import path from "node:path";
import { SETTINGS_PATH } from "./paths.js";
import type { MountTarget } from "./mount.js";

export type SettingsFile = { targets: MountTarget[]; current?: string };

/** Same file `latch init` writes. Tests can point LATCH_SETTINGS at a temp file. */
export function settingsFilePath(): string {
  const override = process.env.LATCH_SETTINGS;
  if (typeof override === "string" && override.trim()) return path.resolve(override);
  return SETTINGS_PATH;
}

export async function loadSettings(): Promise<SettingsFile> {
  try {
    const raw = await fs.readFile(settingsFilePath(), "utf8");
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return { targets: [] };
  }
}

export async function saveSettings(settings: SettingsFile): Promise<void> {
  await fs.writeFile(
    settingsFilePath(),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}
