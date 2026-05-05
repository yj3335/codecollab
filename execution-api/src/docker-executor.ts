import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import type { RunRequest, RunResult } from "../../shared/types.js";
import { config } from "./config.js";
import type { ExecutionEventSink } from "./ecs-executor.js";

const IMAGE_PREFIX = "CODECOLLAB_IMAGE:";

const toErrorOutput = (message: string): Pick<RunResult, "stdout" | "stderr" | "exitCode"> => ({
  stdout: "",
  stderr: message,
  exitCode: 1,
});

export const executePythonLocally = async (
  runId: string,
  request: RunRequest,
  sink: ExecutionEventSink,
): Promise<RunResult> => {
  const startedAt = Date.now();
  const workspaceDir = await mkdtemp(join(tmpdir(), "codecollab-run-"));
  const codePath = join(workspaceDir, "main.py");
  const stdinPath = join(workspaceDir, "stdin.txt");

  try {
    await writeFile(codePath, request.code, "utf8");
    await writeFile(stdinPath, request.stdin ?? "", "utf8");

    const timeoutSeconds = request.timeout ?? config.runnerTimeoutSeconds;
    const dockerArgs = [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,size=64m",
      "--memory",
      config.runnerMemoryLimit,
      "--pids-limit",
      "64",
      "-e",
      "RUN_FILE=/workspace/main.py",
      "-e",
      "STDIN_FILE=/workspace/stdin.txt",
      "-e",
      `RUN_TIMEOUT_SECONDS=${timeoutSeconds}`,
      "-v",
      `${workspaceDir}:/workspace:ro`,
      config.pythonRunnerImage,
    ];

    const child = spawn("docker", dockerArgs, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    sink.emit({
      type: "start",
      data: `Launching local Docker runner for run ${runId}`,
      timestamp: new Date().toISOString(),
    });

    child.stdout.on("data", (chunk) => {
      const message = chunk.toString();
      stdout += message;
      sink.emit({
        type: "stdout",
        data: message,
        timestamp: new Date().toISOString(),
      });
    });

    child.stderr.on("data", (chunk) => {
      const message = chunk.toString();
      stderr += message;
      sink.emit({
        type: "stderr",
        data: message,
        timestamp: new Date().toISOString(),
      });
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    const executionTime = Date.now() - startedAt;

    sink.emit({
      type: "complete",
      data: JSON.stringify({ exitCode, executionTime }),
      timestamp: new Date().toISOString(),
    });

    return {
      id: runId,
      sessionId: request.sessionId,
      code: request.code,
      language: request.language,
      stdout,
      stderr,
      exitCode,
      executionTime,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const executionTime = Date.now() - startedAt;
    const message =
      error instanceof Error ? error.message : "Unknown execution error";

    sink.emit({
      type: "error",
      data: `Local Docker stub failed: ${message}`,
      timestamp: new Date().toISOString(),
    });

    return {
      id: runId,
      sessionId: request.sessionId,
      code: request.code,
      language: request.language,
      executionTime,
      timestamp: new Date().toISOString(),
      ...toErrorOutput(`Local Docker stub failed: ${message}`),
    };
  } finally {
    await rm(workspaceDir, { recursive: true, force: true });
  }
};

export const extractImages = (stdout: string): string[] =>
  stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(IMAGE_PREFIX));
