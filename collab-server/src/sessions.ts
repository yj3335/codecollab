import { Router } from "express"
import { randomUUID } from "crypto"
import * as Y from "yjs"
import { DynamoDBPersistence } from "./persistence.js"
import { logger } from "./logger.js"

export const sessionRouter = Router()
const dynamo = new DynamoDBPersistence()

sessionRouter.post("/", async (req, res) => {
  const { name, language, isPublic = false, ownerId } = req.body
  if (!name || !language || !ownerId) {
    return res.status(400).json({ success: false, error: "name, language, and ownerId are required" })
  }
  const id = randomUUID()
  const now = new Date().toISOString()
  const session = { id, name, language, ownerId, isPublic, createdAt: now, updatedAt: now }
  try {
    await dynamo.createSession(session)
    logger.info({ sessionId: id }, "Session created")
    return res.status(201).json({ success: true, data: session })
  } catch (err) {
    logger.error({ err }, "createSession failed")
    return res.status(500).json({ success: false, error: "Failed to create session" })
  }
})

sessionRouter.get("/:id", async (req, res) => {
  try {
    const session = await dynamo.getSession(req.params.id)
    if (!session) return res.status(404).json({ success: false, error: "Not found" })
    return res.json({ success: true, data: session })
  } catch (err) {
    logger.error({ err }, "getSession failed")
    return res.status(500).json({ success: false, error: "Failed to get session" })
  }
})

sessionRouter.post("/:id/duplicate", async (req, res) => {
  const { newName, ownerId } = req.body
  if (!newName || !ownerId) {
    return res.status(400).json({ success: false, error: "newName and ownerId are required" })
  }
  try {
    const original = await dynamo.getSession(req.params.id)
    if (!original) return res.status(404).json({ success: false, error: "Not found" })

    const newId = randomUUID()
    const now = new Date().toISOString()
    const newSession = { id: newId, name: newName, language: original.language, ownerId, isPublic: false, createdAt: now, updatedAt: now }

    await dynamo.createSession(newSession)
    const state = await dynamo.loadSessionState(req.params.id)
    await dynamo.saveSessionState(newId, state ?? Y.encodeStateAsUpdate(new Y.Doc()))

    logger.info({ originalId: req.params.id, newId }, "Session duplicated")
    return res.status(201).json({ success: true, data: newSession })
  } catch (err) {
    logger.error({ err }, "duplicate failed")
    return res.status(500).json({ success: false, error: "Failed to duplicate" })
  }
})