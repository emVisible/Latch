import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const LATCH_ROOT = path.resolve(here, "..");
export const LIBRARY_DIR = path.join(LATCH_ROOT, "library");
export const SKILLS_DIR = path.join(LIBRARY_DIR, "skills");
export const DOMAINS_DIR = path.join(LIBRARY_DIR, "domains");
export const SETTINGS_PATH = path.join(LATCH_ROOT, "settings.json");
