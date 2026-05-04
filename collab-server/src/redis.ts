import { createClient, type RedisClientType } from "redis"
import { logger } from "./logger.js"

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"

export class RedisAdapter {
  private pub: RedisClientType
  private sub: RedisClientType

  constructor() {
    this.pub = createClient({ url: REDIS_URL }) as RedisClientType
    this.sub = this.pub.duplicate() as RedisClientType
    this.pub.on("error", (err) => logger.error({ err }, "Redis pub error"))
    this.sub.on("error", (err) => logger.error({ err }, "Redis sub error"))
  }

  async connect(): Promise<void> {
    await Promise.all([this.pub.connect(), this.sub.connect()])
    logger.info("Redis connected")
  }

  async disconnect(): Promise<void> {
    await Promise.all([this.pub.quit(), this.sub.quit()])
  }

  async publishUpdate(sessionId: string, update: Uint8Array): Promise<void> {
    await this.pub.publish(`yjs:${sessionId}`, Buffer.from(update).toString("base64"))
  }

  async subscribeToUpdates(
    sessionId: string,
    onUpdate: (update: Uint8Array) => void
  ): Promise<void> {
    await this.sub.subscribe(`yjs:${sessionId}`, (message) => {
      onUpdate(new Uint8Array(Buffer.from(message, "base64")))
    })
  }

  async unsubscribeFromUpdates(sessionId: string): Promise<void> {
    await this.sub.unsubscribe(`yjs:${sessionId}`)
  }

  async publishAwareness(sessionId: string, update: Uint8Array): Promise<void> {
    await this.pub.publish(`awareness:${sessionId}`, Buffer.from(update).toString("base64"))
  }

  async subscribeToAwareness(
    sessionId: string,
    onUpdate: (update: Uint8Array) => void
  ): Promise<void> {
    await this.sub.subscribe(`awareness:${sessionId}`, (message) => {
      onUpdate(new Uint8Array(Buffer.from(message, "base64")))
    })
  }

  async unsubscribeFromAwareness(sessionId: string): Promise<void> {
    await this.sub.unsubscribe(`awareness:${sessionId}`)
  }

  async refreshPresence(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.pub.set(`presence:${sessionId}`, "1", { EX: ttlSeconds })
  }
}