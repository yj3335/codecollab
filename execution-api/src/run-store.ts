import type { RunResult } from "../../shared/types.js";

const runs = new Map<string, RunResult>();

export const saveRun = (run: RunResult): void => {
  runs.set(run.id, run);
};

export const getRun = (id: string): RunResult | undefined => runs.get(id);
