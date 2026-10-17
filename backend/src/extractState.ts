import { promises as fs } from "node:fs";

export type ExtractState = {
  state: "idle" | "running" | "succeeded" | "failed" | "interrupted";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  log: string;
};
export const IDLE_STATE: ExtractState = {
  state: "idle",
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  log: "",
};

/** Recover persisted state after the API process has been recreated. */
export async function readSavedExtractState(
  file: string,
  hasChild: boolean,
  livePid: () => Promise<number | null>,
): Promise<ExtractState> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = { ...IDLE_STATE, ...(JSON.parse(raw) as Partial<ExtractState>) };
    if (parsed.state === "running" && !hasChild && (await livePid()) === null) {
      return { ...parsed, state: "interrupted", error: "The backend restarted while extraction was running." };
    }
    return parsed;
  } catch {
    return IDLE_STATE;
  }
}
