import { useCallback, useRef, useState } from "react";
import {
  ApiError,
  executionWsBaseUrl,
  getRun,
  postRunAsync,
  type RunResult,
  type StreamEvent,
} from "../lib/api";

export type OutputLine =
  | { kind: "out"; text: string }
  | { kind: "err"; text: string }
  | { kind: "image"; src: string }
  | { kind: "meta"; text: string };

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 180_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRunResult = (value: Awaited<ReturnType<typeof getRun>>): value is RunResult =>
  "exitCode" in value;

function emitLine(
  line: string,
  push: (fn: (prev: OutputLine[]) => OutputLine[]) => void
) {
  if (line.startsWith("CODECOLLAB_IMAGE:")) {
    const src = line.slice("CODECOLLAB_IMAGE:".length);
    push((prev) => [...prev, { kind: "image", src }]);
  } else {
    push((prev) => [...prev, { kind: "out", text: line + "\n" }]);
  }
}

export function useExecution() {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<ApiError["kind"] | null>(null);
  const stdoutBufRef = useRef("");
  const lastRequestRef = useRef<{
    code: string;
    sessionId: string;
    language: string;
  } | null>(null);

  const clear = useCallback(() => {
    stdoutBufRef.current = "";
    setLines([]);
    setError(null);
    setErrorKind(null);
  }, []);

  const pushLines = useCallback((fn: (prev: OutputLine[]) => OutputLine[]) => {
    setLines(fn);
  }, []);

  const feedStdout = useCallback(
    (chunk: string) => {
      stdoutBufRef.current += chunk;
      const parts = stdoutBufRef.current.split(/\r?\n/);
      stdoutBufRef.current = parts.pop() ?? "";
      for (const line of parts) {
        emitLine(line, pushLines);
      }
    },
    [pushLines]
  );

  const flushStdout = useCallback(() => {
    if (stdoutBufRef.current.length > 0) {
      emitLine(stdoutBufRef.current, pushLines);
      stdoutBufRef.current = "";
    }
  }, [pushLines]);

  const appendCompletion = useCallback(
    (exitCode?: number, executionTime?: number) => {
      pushLines((prev) => [
        ...prev,
        {
          kind: "meta",
          text: `\n[exit ${exitCode ?? "?"} in ${executionTime ?? "?"} ms]\n`,
        },
      ]);
    },
    [pushLines]
  );

  const run = useCallback(
    async (code: string, sessionId: string, language: string) => {
      clear();
      lastRequestRef.current = { code, sessionId, language };
      setRunning(true);
      try {
        const ack = await postRunAsync({ sessionId, code, language });
        const wsUrl = `${executionWsBaseUrl()}/api/run/${encodeURIComponent(ack.runId)}/stream`;
        let terminalReceived = false;
        let streamedStdout = "";
        let streamedStderr = "";

        const applyFinalResult = (result: RunResult) => {
          const remainingStdout = result.stdout.startsWith(streamedStdout)
            ? result.stdout.slice(streamedStdout.length)
            : result.stdout;
          const remainingStderr = result.stderr.startsWith(streamedStderr)
            ? result.stderr.slice(streamedStderr.length)
            : result.stderr;

          if (remainingStdout) {
            feedStdout(remainingStdout);
          }
          if (remainingStderr) {
            pushLines((prev) => [...prev, { kind: "err", text: remainingStderr }]);
          }
          appendCompletion(result.exitCode, result.executionTime);
        };

        const pollForFinalResult = async () => {
          const deadline = Date.now() + POLL_TIMEOUT_MS;
          pushLines((prev) => [
            ...prev,
            {
              kind: "meta",
              text: "\nRun stream disconnected; polling for final output...\n",
            },
          ]);

          while (Date.now() < deadline) {
            const status = await getRun(ack.runId);
            if (isRunResult(status)) {
              applyFinalResult(status);
              return;
            }
            await wait(POLL_INTERVAL_MS);
          }

          throw new ApiError(
            "Execution is still running after the stream disconnected. Try checking run status again.",
            "timeout"
          );
        };

        try {
          await new Promise<void>((resolve) => {
            const ws = new WebSocket(wsUrl);
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(ev.data) as StreamEvent;
                if (msg.type === "stdout") {
                  streamedStdout += msg.data;
                  feedStdout(msg.data);
                } else if (msg.type === "stderr") {
                  streamedStderr += msg.data;
                  pushLines((prev) => [...prev, { kind: "err", text: msg.data }]);
                } else if (msg.type === "start") {
                  pushLines((prev) => [...prev, { kind: "meta", text: `${msg.data}\n` }]);
                } else if (msg.type === "complete") {
                  terminalReceived = true;
                  try {
                    const parsed = JSON.parse(msg.data) as {
                      exitCode?: number;
                      executionTime?: number;
                    };
                    appendCompletion(parsed.exitCode, parsed.executionTime);
                  } catch {
                    pushLines((prev) => [...prev, { kind: "meta", text: `\n${msg.data}\n` }]);
                  }
                } else if (msg.type === "error") {
                  terminalReceived = true;
                  setError(`Run stream error: ${msg.data}`);
                  setErrorKind("server");
                }
              } catch {
                /* ignore malformed frames */
              }
            };
            ws.onerror = () => resolve();
            ws.onclose = () => resolve();
          });

          if (!terminalReceived) {
            await pollForFinalResult();
          }
        } finally {
          flushStdout();
        }
      } catch (e) {
        if (e instanceof ApiError) {
          setErrorKind(e.kind);
          if (e.kind === "timeout") {
            setError("Execution timed out. Reduce runtime or increase timeout and retry.");
          } else if (e.kind === "network") {
            setError("Could not reach execution service. Check that it is running.");
          } else {
            setError(e.message);
          }
        } else {
          setError("Run failed.");
          setErrorKind("unknown");
        }
      } finally {
        setRunning(false);
      }
    },
    [appendCompletion, clear, feedStdout, flushStdout, pushLines]
  );

  const rerun = useCallback(async () => {
    const last = lastRequestRef.current;
    if (!last || running) {
      return;
    }
    await run(last.code, last.sessionId, last.language);
  }, [run, running]);

  return { lines, running, error, errorKind, run, clear, rerun };
}
