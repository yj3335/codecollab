import { createServer } from "http"
import { createRequire } from "module"
import express from "express"
import { WebSocketServer } from "ws"
import { sessionRouter } from "./sessions.js"
import { RoomManager } from "./rooms.js"
import { RedisAdapter } from "./redis.js"
import { logger } from "./logger.js"

const require = createRequire(import.meta.url)
const { setupWSConnection } = require("y-websocket/bin/utils")

const app = express()
app.use(express.json())

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() })
})

app.use("/api/sessions", sessionRouter)

app.post("/api/run", (_req, res) => {
  res.json({ success: true, data: { id: "mock-run-id", stdout: "Hello, World!\n", stderr: "", exitCode: 0, executionTime: 42, timestamp: new Date().toISOString() } })
})

app.post("/api/translate", (_req, res) => {
  res.json({ success: true, data: { id: "mock-translate-id", translatedCode: "print('hello')", explanation: "Mock — Week 2", timestamp: new Date().toISOString() } })
})

const server = createServer(app)
const wss = new WebSocketServer({ server })
const redis = new RedisAdapter()
const rooms = new RoomManager(redis)

wss.on("connection", async (ws, req) => {
  const sessionId = req.url?.split("/").pop()
  if (!sessionId) { ws.close(1008, "Missing sessionId"); return }

  logger.info({ sessionId }, "Client connected")
  try {
    await rooms.ensureRoomLoaded(sessionId)
    setupWSConnection(ws, req, { docName: sessionId, gc: true })
    await rooms.trackPresence(sessionId, ws)

    ws.on("close", async () => {
      logger.info({ sessionId }, "Client disconnected")
      await rooms.onClientDisconnect(sessionId, ws)
    })
    ws.on("error", (err) => logger.error({ sessionId, err }, "WS error"))
  } catch (err) {
    logger.error({ sessionId, err }, "Room setup failed")
    ws.close(1011, "Internal error")
  }
})

const PORT = Number(process.env.PORT ?? 8000)
server.listen(PORT, async () => {
  await redis.connect()
  logger.info({ port: PORT }, "Collab server started")
})

process.on("SIGTERM", async () => {
  await redis.disconnect()
  server.close(() => process.exit(0))
})