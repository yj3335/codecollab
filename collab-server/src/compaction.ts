/**
 * Nightly compaction Lambda handler.
 *
 * For each session that has incremental Yjs updates in S3:
 * 1. Load the current compacted state from DynamoDB
 * 2. List and download all incremental updates from S3
 * 3. Apply them to produce a new compacted state
 * 4. Write the compacted state back to DynamoDB
 * 5. Delete the processed S3 objects
 *
 * This keeps the DynamoDB row up-to-date and prevents unbounded S3 growth.
 * Designed to run as an AWS Lambda triggered by EventBridge (nightly schedule).
 */

import { createRequire } from "module"
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3"
import { DynamoDBPersistence } from "./persistence.js"
import { logger } from "./logger.js"

const require = createRequire(import.meta.url)
const Y = require("yjs")

const BUCKET = process.env.S3_BUCKET_LOGS ?? "codecollab-edit-logs-dev"
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" })
const dynamo = new DynamoDBPersistence()

interface CompactionResult {
  sessionId: string
  updatesApplied: number
  objectsDeleted: number
  error?: string
}

async function listSessionPrefixes(): Promise<string[]> {
  const sessionIds = new Set<string>()
  let continuationToken: string | undefined

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: "sessions/",
        Delimiter: "/",
        ContinuationToken: continuationToken,
      })
    )
    for (const prefix of res.CommonPrefixes ?? []) {
      // prefix.Prefix = "sessions/{sessionId}/"
      const parts = prefix.Prefix?.split("/")
      if (parts && parts[1]) sessionIds.add(parts[1])
    }
    continuationToken = res.NextContinuationToken
  } while (continuationToken)

  return Array.from(sessionIds)
}

async function compactSession(sessionId: string): Promise<CompactionResult> {
  const prefix = `sessions/${sessionId}/`
  const result: CompactionResult = { sessionId, updatesApplied: 0, objectsDeleted: 0 }

  try {
    // List all incremental update objects for this session
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
      const res = await s3.send(
        new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      )
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key)
      }
      continuationToken = res.NextContinuationToken
    } while (continuationToken)

    if (keys.length === 0) return result

    // Load current state from DynamoDB
    const doc = new Y.Doc()
    const saved = await dynamo.loadSessionState(sessionId)
    if (saved) Y.applyUpdate(doc, saved)

    // Download and apply each incremental update
    for (const key of keys) {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
        const body = await res.Body?.transformToByteArray()
        if (body) {
          Y.applyUpdate(doc, new Uint8Array(body))
          result.updatesApplied++
        }
      } catch (err) {
        logger.warn({ sessionId, key, err }, "Failed to apply update, skipping")
      }
    }

    // Write compacted state back to DynamoDB
    const compacted = Y.encodeStateAsUpdate(doc)
    await dynamo.saveSessionState(sessionId, compacted)
    doc.destroy()

    // Delete processed S3 objects (batch delete, max 1000 per request)
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        })
      )
      result.objectsDeleted += batch.length
    }

    logger.info(
      { sessionId, updatesApplied: result.updatesApplied, objectsDeleted: result.objectsDeleted },
      "Session compacted"
    )
  } catch (err: any) {
    result.error = err.message
    logger.error({ sessionId, err }, "Compaction failed")
  }

  return result
}

export async function handler(): Promise<{ statusCode: number; body: string }> {
  logger.info("Compaction Lambda started")

  const sessionIds = await listSessionPrefixes()
  logger.info({ sessionCount: sessionIds.length }, "Found sessions with S3 edit logs")

  const results: CompactionResult[] = []
  for (const sessionId of sessionIds) {
    const result = await compactSession(sessionId)
    results.push(result)
  }

  const totalUpdates = results.reduce((sum, r) => sum + r.updatesApplied, 0)
  const totalDeleted = results.reduce((sum, r) => sum + r.objectsDeleted, 0)
  const errors = results.filter((r) => r.error)

  const summary = {
    sessionsProcessed: results.length,
    totalUpdatesApplied: totalUpdates,
    totalObjectsDeleted: totalDeleted,
    errors: errors.length,
  }
  logger.info(summary, "Compaction complete")

  return {
    statusCode: errors.length > 0 ? 207 : 200,
    body: JSON.stringify(summary),
  }
}
