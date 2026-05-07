import cors from "cors";
import express from "express";
import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

import type {
  ApiResponse,
  RunRequest,
  RunResult,
  StreamEvent,
} from "../../shared/types.js";
import { config, normalizeLanguage } from "./config.js";
import { executeLocally, extractImages } from "./docker-executor.js";
import { executeViaEcs } from "./ecs-executor.js";
import {
  getRunError,
  getRunResult,
  hasRun,
  isRunTerminal,
  listRunsForSession,
  markRunFailed,
  markRunTerminal,
  pushRunEvent,
  registerRun,
  saveRun,
  subscribeToRun,
} from "./run-store.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

interface AsyncRunAccepted {
  runId: string;
  streamUrl: string;
  statusUrl: string;
}

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

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/sessions/:sessionId/runs", (req, res) => {
  const { sessionId } = req.params;
  const limit = Number.parseInt(String(req.query.limit ?? "20"), 10);
  const offset = Number.parseInt(String(req.query.offset ?? "0"), 10);

  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20;
  const safeOffset = Number.isFinite(offset) ? Math.max(offset, 0) : 0;
  const data = listRunsForSession(sessionId, safeLimit, safeOffset);

  res.status(200).json({
    success: true,
    data,
    statusCode: 200,
  });
});

const isSupportedLanguage = (language: string): boolean =>
  normalizeLanguage(language) !== undefined;

const buildStreamUrl = (req: express.Request, runId: string): string => {
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
  const wsProtocol = protocol === "https" ? "wss" : "ws";
  return `${wsProtocol}://${req.get("host")}/api/run/${runId}/stream`;
};

const executeRun = async (
  runId: string,
  request: RunRequest,
): Promise<RunResult> => {
  const emit = (event: StreamEvent) => {
    pushRunEvent(runId, event);
  };

  try {
    const runResult =
      config.executionMode === "local"
        ? await executeLocally(runId, request, { emit })
        : await executeViaEcs(runId, request, { emit });

    saveRun(runResult);
    markRunTerminal(runId);

    console.log("info:", "Run completed", {
      runId,
      sessionId: runResult.sessionId,
      exitCode: runResult.exitCode,
      executionTime: runResult.executionTime,
      imagesDetected: extractImages(runResult.stdout).length,
      executionMode: config.executionMode,
    });

    return runResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown execution error";

    pushRunEvent(runId, {
      type: "error",
      data: message,
      timestamp: new Date().toISOString(),
    });
    markRunFailed(runId, message);
    throw error;
  }
};

app.get("/api/run/:runId", (req, res) => {
  const { runId } = req.params;

  if (!hasRun(runId)) {
    res.status(404).json({
      success: false,
      error: `Run ${runId} not found.`,
      statusCode: 404,
    });
    return;
  }

  const runResult = getRunResult(runId);
  if (runResult) {
    res.status(200).json({
      success: true,
      data: runResult,
      statusCode: 200,
    });
    return;
  }

  const runError = getRunError(runId);
  if (runError) {
    res.status(500).json({
      success: false,
      error: runError,
      statusCode: 500,
    });
    return;
  }

  res.status(202).json({
    success: true,
    data: {
      runId,
      status: "running",
    },
    statusCode: 202,
  });
});

app.post(
  "/api/run/async",
  (
    req,
    res: express.Response<ApiResponse<AsyncRunAccepted>>,
  ): void => {
    if (!isRunRequest(req.body)) {
      res.status(400).json({
        success: false,
        error: "Invalid run payload",
        statusCode: 400,
      });
      return;
    }

    if (!isSupportedLanguage(req.body.language)) {
      res.status(400).json({
        success: false,
        error: "Unsupported language. Use python or javascript.",
        statusCode: 400,
      });
      return;
    }

    const runId = randomUUID();
    registerRun(runId);

    void executeRun(runId, req.body).catch(() => undefined);

    res.status(202).json({
      success: true,
      data: {
        runId,
        streamUrl: buildStreamUrl(req, runId),
        statusUrl: `/api/run/${runId}`,
      },
      statusCode: 202,
    });
  },
);

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

    if (!isSupportedLanguage(req.body.language)) {
      res.status(400).json({
        success: false,
        error: "Unsupported language. Use python or javascript.",
        statusCode: 400,
      });
      return;
    }

    const runId = randomUUID();
    registerRun(runId);

    try {
      const runResult = await executeRun(runId, req.body);

      res.status(200).json({
        success: true,
        data: runResult,
        statusCode: 200,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown execution error";

      res.status(500).json({
        success: false,
        error: message,
        statusCode: 500,
      });
    }
  },
);

const server = createServer(app);
const streamServer = new WebSocketServer({ noServer: true });

streamServer.on(
  "connection",
  (socket: WebSocket, _request: IncomingMessage, runId: string) => {
    const emitToSocket = (event: StreamEvent) => {
      socket.send(JSON.stringify(event));
    };

    if (!hasRun(runId)) {
      emitToSocket({
        type: "error",
        data: `Run ${runId} not found.`,
        timestamp: new Date().toISOString(),
      });
      socket.close();
      return;
    }

    const unsubscribe = subscribeToRun(runId, (event) => {
      emitToSocket(event);
      if (event.type === "complete" || event.type === "error") {
        socket.close();
      }
    });

    socket.on("close", () => {
      unsubscribe();
    });

    if (isRunTerminal(runId)) {
      socket.close();
    }
  },
);

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
    `Execution API listening on http://localhost:${config.port} (${config.executionMode} execution mode)`,
  );
});
