import { readReceipts } from "./journal.js";

/** Builds a blank exam from read receipts. Must not import the atom registry or a card SKILL. */
export async function draftExam(card: string, cwd: string): Promise<string> {
  const reads = await readReceipts(cwd);
  const source = reads[0] ?? { path: "", sha256: "" };
  const blank = {
    added: [] as string[],
    removed: [] as string[],
    changedPaths: source.path ? [source.path] : [],
  };
  return `${JSON.stringify(
    {
      card,
      sources: reads,
      questions: [
        { role: "routine", expect: true, source, fixture: blank },
        { role: "routine", expect: false, source, fixture: blank },
        { role: "trap", expect: false, source, naive: source, fixture: blank },
      ],
    },
    null,
    2,
  )}\n`;
}
