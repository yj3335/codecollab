import { useCallback, useRef, useState } from "react";
import {
  executionWsBaseUrl,
  postRun,
  type StreamEvent,
} from "../lib/api";

export type OutputLine =
  | { kind: "out"; text: string }
  | { kind: "err"; text: string }
  | { kind: "image"; src: string }
  | { kind: "meta"; text: string };

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
  const stdoutBufRef = useRef("");

  const clear = useCallback(() => {
    stdoutBufRef.current = "";
    setLines([]);
    setError(null);
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

  const run = useCallback(
    async (code: string, sessionId: string, language: string) => {
      clear();
      setRunning(true);
      try {
        const result = await postRun({ sessionId, code, language });
        const wsUrl = `${executionWsBaseUrl()}/api/run/${encodeURIComponent(result.id)}/stream`;

        try {
          await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(wsUrl);
            ws.onmessage = (ev) => {
              try {
                const msg = JSON.parse(ev.data) as StreamEvent;
                if (msg.type === "stdout") {
                  feedStdout(msg.data);
                } else if (msg.type === "stderr") {
                  pushLines((prev) => [...prev, { kind: "err", text: msg.data }]);
                } else if (msg.type === "start") {
                  pushLines((prev) => [...prev, { kind: "meta", text: `${msg.data}\n` }]);
                } else if (msg.type === "complete") {
                  try {
                    const parsed = JSON.parse(msg.data) as {
                      exitCode?: number;
                      executionTime?: number;
                    };
                    pushLines((prev) => [
                      ...prev,
                      {
                        kind: "meta",
                        text: `\n[exit ${parsed.exitCode ?? "?"} in ${parsed.executionTime ?? "?"} ms]\n`,
                      },
                    ]);
                  } catch {
                    pushLines((prev) => [...prev, { kind: "meta", text: `\n${msg.data}\n` }]);
                  }
                } else if (msg.type === "error") {
                  setError(msg.data);
                }
              } catch {
                /* ignore malformed frames */
              }
            };
            ws.onerror = () => reject(new Error("WebSocket connection error"));
            ws.onclose = () => resolve();
          });
        } finally {
          flushStdout();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Run failed");
      } finally {
        setRunning(false);
      }
    },
    [clear, feedStdout, flushStdout, pushLines]
  );

  return { lines, running, error, run, clear };
}
