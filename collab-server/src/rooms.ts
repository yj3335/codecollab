import * as Y from "yjs"
import type { WebSocket } from "ws"
import { RedisAdapter } from "./redis.js"
import { DynamoDBPersistence } from "./persistence.js"
import { S3EditLog } from "./editlog.js"
import { logger } from "./logger.js"

const PRESENCE_INTERVAL_MS = 5_000
const PRESENCE_TTL_S = 10
const REMOTE_ORIGIN = "remote"

interface Room {
  doc: Y.Doc
  clients: Set<WebSocket>
  presenceTimers: Map<WebSocket, ReturnType<typeof setInterval>>
}

export class RoomManager {
  private rooms = new Map<string, Room>()
  private dynamo = new DynamoDBPersistence()
  private s3 = new S3EditLog()

  constructor(private redis: RedisAdapter) {}

  async ensureRoomLoaded(sessionId: string): Promise<Room> {
    if (this.rooms.has(sessionId)) return this.rooms.get(sessionId)!

    logger.info({ sessionId }, "Cold loading from DynamoDB")
    const doc = new Y.Doc()

    const saved = await this.dynamo.loadSessionState(sessionId)
    if (saved) {
      Y.applyUpdate(doc, saved, REMOTE_ORIGIN)
      logger.info({ sessionId }, "State restored from DynamoDB")
    } else {
      logger.info({ sessionId }, "No saved state — fresh doc")
    }

    doc.on("update", async (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return
      await Promise.allSettled([
        this.s3.appendUpdate(sessionId, update),
        this.redis.publishUpdate(sessionId, update),
      ])
    })

    const room: Room = { doc, clients: new Set(), presenceTimers: new Map() }
    this.rooms.set(sessionId, room)

    await this.redis.subscribeToUpdates(sessionId, (remoteUpdate) => {
      Y.applyUpdate(room.doc, remoteUpdate, REMOTE_ORIGIN)
    })

    return room
  }

  async trackPresence(sessionId: string, ws: WebSocket): Promise<void> {
    const room = this.rooms.get(sessionId)
    if (!room) return

    room.clients.add(ws)

    const timer = setInterval(async () => {
      if (ws.readyState !== ws.OPEN) return
      try {
        await this.redis.refreshPresence(sessionId, PRESENCE_TTL_S)
      } catch (err) {
        logger.error({ sessionId, err }, "Presence heartbeat failed")
      }
    }, PRESENCE_INTERVAL_MS)

    room.presenceTimers.set(ws, timer)
  }

  async onClientDisconnect(sessionId: string, ws: WebSocket): Promise<void> {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const timer = room.presenceTimers.get(ws)
    if (timer) { clearInterval(timer); room.presenceTimers.delete(ws) }
    room.clients.delete(ws)

    const stillOpen = [...room.clients].filter((c) => c.readyState === c.OPEN)
    if (stillOpen.length > 0) {
      logger.info({ sessionId, remaining: stillOpen.length }, "Still has clients, skipping flush")
      return
    }

    logger.info({ sessionId }, "Last client — flushing to DynamoDB")
    try {
      await this.dynamo.saveSessionState(sessionId, Y.encodeStateAsUpdate(room.doc))
      logger.info({ sessionId }, "Flushed to DynamoDB")
    } catch (err) {
      logger.error({ sessionId, err }, "Flush failed")
    }

    for (const t of room.presenceTimers.values()) clearInterval(t)
    await this.redis.unsubscribeFromUpdates(sessionId)
    this.rooms.delete(sessionId)
    logger.info({ sessionId }, "Room evicted")
  }
}