import fs from "node:fs/promises";
import { SETTINGS_PATH } from "./paths.js";
import type { MountTarget } from "./mount.js";

type SettingsFile = { targets: MountTarget[] };

export async function loadSettings(): Promise<SettingsFile> {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    return JSON.parse(raw) as SettingsFile;
  } catch {
    return { targets: [] };
  }
}

export async function saveSettings(settings: SettingsFile): Promise<void> {
  await fs.writeFile(
    SETTINGS_PATH,
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf8",
  );
}
