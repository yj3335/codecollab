import type { RunResult, StreamEvent } from "../../shared/types.js";

type RunSubscriber = (event: StreamEvent) => void;

interface RunRecord {
  events: StreamEvent[];
  result?: RunResult;
  error?: string;
  terminal: boolean;
  subscribers: Set<RunSubscriber>;
}

const runs = new Map<string, RunRecord>();
const sessionRuns = new Map<string, string[]>();

const getOrCreateRun = (id: string): RunRecord => {
  const existing = runs.get(id);
  if (existing) {
    return existing;
  }

  const created: RunRecord = {
    events: [],
    terminal: false,
    subscribers: new Set<RunSubscriber>(),
  };
  runs.set(id, created);
  return created;
};

export const registerRun = (id: string): void => {
  getOrCreateRun(id);
};

export const pushRunEvent = (id: string, event: StreamEvent): void => {
  const run = getOrCreateRun(id);
  run.events.push(event);
  for (const subscriber of run.subscribers) {
    subscriber(event);
  }
};

export const saveRun = (runResult: RunResult): void => {
  const run = getOrCreateRun(runResult.id);
  run.result = runResult;
  run.error = undefined;

  const existing = sessionRuns.get(runResult.sessionId) ?? [];
  if (!existing.includes(runResult.id)) {
    existing.unshift(runResult.id);
    sessionRuns.set(runResult.sessionId, existing);
  }
};

export const markRunTerminal = (id: string): void => {
  const run = getOrCreateRun(id);
  run.terminal = true;
};

export const markRunFailed = (id: string, message: string): void => {
  const run = getOrCreateRun(id);
  run.error = message;
  run.terminal = true;
};

export const hasRun = (id: string): boolean => runs.has(id);

export const isRunTerminal = (id: string): boolean =>
  runs.get(id)?.terminal ?? false;

export const getRunResult = (id: string): RunResult | undefined =>
  runs.get(id)?.result;

export const getRunError = (id: string): string | undefined => runs.get(id)?.error;

export const subscribeToRun = (
  id: string,
  subscriber: RunSubscriber,
): (() => void) => {
  const run = getOrCreateRun(id);

  for (const event of run.events) {
    subscriber(event);
  }

  if (run.terminal) {
    return () => {};
  }

  run.subscribers.add(subscriber);
  return () => {
    run.subscribers.delete(subscriber);
  };
};

export const listRunsForSession = (
  sessionId: string,
  limit: number,
  offset: number,
): { runs: RunResult[]; total: number } => {
  const runIds = sessionRuns.get(sessionId) ?? [];
  const runsForSession = runIds
    .map((runId) => runs.get(runId)?.result)
    .filter((result): result is RunResult => Boolean(result));

  return {
    runs: runsForSession.slice(offset, offset + limit),
    total: runsForSession.length,
  };
};
