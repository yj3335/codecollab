import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { logger } from "./logger.js"

const BUCKET = process.env.S3_BUCKET_LOGS ?? "codecollab-edit-logs-dev"

const client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL, forcePathStyle: true }
    : {}),
})

export class S3EditLog {
  async appendUpdate(sessionId: string, update: Uint8Array): Promise<void> {
    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const key = `sessions/${sessionId}/${ts}-${rand}.bin`
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: Buffer.from(update),
          ContentType: "application/octet-stream",
        })
      )
    } catch (err) {
      logger.warn({ sessionId, err }, "S3 appendUpdate failed (non-fatal)")
    }
  }
}