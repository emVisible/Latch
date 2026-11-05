import { loadSettings } from "../shared/settings.js";
import { mountSkill } from "../shared/mount.js";

const settings = await loadSettings();
const target = settings.targets.find((t) => t.id === "openstrat_rn");
if (!target) {
  throw new Error("settings.json 缺少 openstrat_rn 目标");
}
const record = await mountSkill("openstrat-change-discipline", target);
console.log(record);
