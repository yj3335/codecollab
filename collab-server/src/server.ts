import { createServer } from "http"
import { createRequire } from "module"
import express from "express"
import cors from "cors"
import { WebSocketServer } from "ws"
import { sessionRouter } from "./sessions.js"
import { RedisAdapter } from "./redis.js"
import { DynamoDBPersistence } from "./persistence.js"
import { S3EditLog } from "./editlog.js"
import { logger } from "./logger.js"

const require = createRequire(import.meta.url)
const Y = require("yjs")
const awarenessProtocol = require("y-protocols/dist/awareness.cjs")
const encoding = require("lib0/dist/encoding.cjs")
const { setupWSConnection, setPersistence, docs } = require("y-websocket/bin/utils")

const MESSAGE_AWARENESS = 1

// --- Services ---
const dynamo = new DynamoDBPersistence()
const s3 = new S3EditLog()
const redis = new RedisAdapter()

// --- Presence tracking ---
const PRESENCE_INTERVAL_MS = 5_000
const PRESENCE_TTL_S = 10
const presenceTimers = new Map<object, ReturnType<typeof setInterval>>()

// --- Wire DynamoDB + S3 persistence into y-websocket's built-in persistence hook ---
setPersistence({
  bindState: async (docName: string, ydoc: any) => {
    logger.info({ sessionId: docName }, "Room opened — loading state from DynamoDB")
    const saved = await dynamo.loadSessionState(docName)
    if (saved) {
      Y.applyUpdate(ydoc, saved)
      logger.info({ sessionId: docName }, "State restored from DynamoDB")
    } else {
      logger.info({ sessionId: docName }, "No saved state — fresh doc")
    }

    // Relay local edits to S3 edit log + Redis Pub/Sub
    ydoc.on("update", async (update: Uint8Array, origin: unknown) => {
      if (origin === "redis") return
      await Promise.allSettled([
        s3.appendUpdate(docName, update),
        redis.publishUpdate(docName, update),
      ])
    })

    // Subscribe to Redis for cross-server sync
    await redis.subscribeToUpdates(docName, (remoteUpdate: Uint8Array) => {
      Y.applyUpdate(ydoc, remoteUpdate, "redis")
    })

    // Cross-server awareness relay via Redis
    const awarenessHandler = ({ added, updated, removed }: any, origin: any) => {
      if (origin === "redis") return
      const changedClients = added.concat(updated, removed)
      if (changedClients.length === 0) return
      const update = awarenessProtocol.encodeAwarenessUpdate(ydoc.awareness, changedClients)
      redis.publishAwareness(docName, update).catch(() => {})
    }
    ydoc.awareness.on("update", awarenessHandler)

    await redis.subscribeToAwareness(docName, (remoteUpdate: Uint8Array) => {
      awarenessProtocol.applyAwarenessUpdate(ydoc.awareness, remoteUpdate, "redis")
    })
  },

  writeState: async (docName: string, ydoc: any) => {
    logger.info({ sessionId: docName }, "Last client disconnected — flushing to DynamoDB")
    try {
      const state = Y.encodeStateAsUpdate(ydoc)
      await dynamo.saveSessionState(docName, state)
      await redis.unsubscribeFromUpdates(docName)
      await redis.unsubscribeFromAwareness(docName)
      logger.info({ sessionId: docName }, "Flushed to DynamoDB")
    } catch (err) {
      logger.error({ sessionId: docName, err }, "Flush to DynamoDB failed")
    }
  },
})

// --- CORS ---
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : undefined // undefined = allow all (dev mode)

const app = express()
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json())

// --- Routes ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

// Lightweight ALB health probe — no JSON parsing, no extra headers.
app.get("/healthz", (_req, res) => {
  res.json({ ok: true })
})

app.use("/api/sessions", sessionRouter)

// --- WebSocket server ---
const server = createServer(app)
const wss = new WebSocketServer({ server })

wss.on("connection", (ws, req) => {
  const sessionId = req.url?.split("/").pop()?.split("?")[0]
  if (!sessionId) {
    ws.close(1008, "Missing sessionId")
    return
  }

  logger.info({ sessionId }, "Client connected")
  setupWSConnection(ws, req, { docName: sessionId, gc: true })

  // Presence heartbeat — broadcast every 5s, auto-expire in Redis after 10s
  const timer = setInterval(async () => {
    if (ws.readyState !== ws.OPEN) return
    try {
      await redis.refreshPresence(sessionId, PRESENCE_TTL_S)
    } catch (err) {
      logger.error({ sessionId, err }, "Presence heartbeat failed")
    }
  }, PRESENCE_INTERVAL_MS)
  presenceTimers.set(ws, timer)

  ws.on("close", () => {
    const t = presenceTimers.get(ws)
    if (t) {
      clearInterval(t)
      presenceTimers.delete(ws)
    }
    logger.info({ sessionId }, "Client disconnected")
  })
})

// --- Start ---
const PORT = Number(process.env.PORT ?? 8000)
server.listen(PORT, async () => {
  await redis.connect()
  logger.info({ port: PORT }, "Collab server started")
})

// --- Graceful shutdown ---
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down")
  for (const timer of presenceTimers.values()) clearInterval(timer)
  presenceTimers.clear()
  await redis.disconnect()
  server.close(() => process.exit(0))
})
