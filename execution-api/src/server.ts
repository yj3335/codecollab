import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

import type { ApiResponse, RunRequest, RunResult, StreamEvent } from "../../shared/types";
import { config } from "./config";
import { executePythonLocally, extractImages } from "./docker-executor";
import { getRun, saveRun } from "./run-store";

const app = express();
app.use(express.json({ limit: "1mb" }));

const isRunRequest = (value: unknown): value is RunRequest => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RunRequest>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.language === "string"
  );
};

app.get("/health", (_req, res) => {
  res.json({ success: true, statusCode: 200, data: { ok: true } });
});

app.post(
  "/api/run",
  async (
    req,
    res: express.Response<ApiResponse<RunResult>>,
  ): Promise<void> => {
    if (!isRunRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: "Invalid run payload",
        statusCode: 400,
      });
      return;
    }

    if (req.body.language.toLowerCase() !== "python") {
      res.status(400).json({
        success: false,
        error: "Week 1 only supports Python runs",
        statusCode: 400,
      });
      return;
    }

    const runId = randomUUID();
    const runResult = await executePythonLocally(runId, req.body);
    saveRun(runResult);

    console.log("info:", "Run completed", {
      runId,
      sessionId: runResult.sessionId,
      exitCode: runResult.exitCode,
      executionTime: runResult.executionTime,
      imagesDetected: extractImages(runResult.stdout).length,
    });

    res.status(200).json({
      success: true,
      data: runResult,
      statusCode: 200,
    });
  },
);

const server = createServer(app);
const streamServer = new WebSocketServer({ noServer: true });

streamServer.on("connection", (socket, request, runId: string) => {
  const run = getRun(runId);

  const emit = (event: StreamEvent) => {
    socket.send(JSON.stringify(event));
  };

  emit({
    type: "start",
    data: run ? `Streaming mock for run ${runId}` : `Run ${runId} not found`,
    timestamp: new Date().toISOString(),
  });

  if (run) {
    if (run.stdout) {
      emit({
        type: "stdout",
        data: run.stdout,
        timestamp: new Date().toISOString(),
      });
    }

    if (run.stderr) {
      emit({
        type: "stderr",
        data: run.stderr,
        timestamp: new Date().toISOString(),
      });
    }

    emit({
      type: "complete",
      data: JSON.stringify({
        exitCode: run.exitCode,
        executionTime: run.executionTime,
      }),
      timestamp: new Date().toISOString(),
    });
  } else {
    emit({
      type: "error",
      data: "This Week 1 stream endpoint is a mock. Run the code first via POST /api/run.",
      timestamp: new Date().toISOString(),
    });
  }

  socket.close();
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "", `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/api\/run\/([^/]+)\/stream$/);

  if (!match) {
    socket.destroy();
    return;
  }

  streamServer.handleUpgrade(request, socket, head, (ws) => {
    streamServer.emit("connection", ws, request, match[1]);
  });
});

server.listen(config.port, () => {
  console.log(
    "info:",
    `Execution API listening on http://localhost:${config.port} (local Docker stub mode)`,
  );
});
