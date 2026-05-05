import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb"
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb"
import { logger } from "./logger.js"

const TABLE = process.env.DYNAMODB_TABLE_SESSIONS ?? "codecollab-sessions-dev"

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  ...(process.env.AWS_ENDPOINT_URL
    ? { endpoint: process.env.AWS_ENDPOINT_URL }
    : {}),
})

export interface SessionRecord {
  sessionId: string
  name: string
  language: string
  ownerId: string
  isPublic: boolean
  createdAt: string
  updatedAt: string
  expiresAt?: number // Unix epoch seconds — DynamoDB TTL
}

export class DynamoDBPersistence {
  async loadSessionState(sessionId: string): Promise<Uint8Array | null> {
    try {
      const result = await client.send(
        new GetItemCommand({
          TableName: TABLE,
          Key: marshall({ sessionId }),
          ProjectionExpression: "#yjs",
          ExpressionAttributeNames: { "#yjs": "yjsState" },
        })
      )
      if (!result.Item) return null
      const item = unmarshall(result.Item)
      if (!item.yjsState) return null
      return new Uint8Array(Buffer.from(item.yjsState))
    } catch (err) {
      logger.error({ sessionId, err }, "DynamoDB loadSessionState failed")
      throw err
    }
  }

  async saveSessionState(sessionId: string, state: Uint8Array): Promise<void> {
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: marshall({ sessionId }),
          UpdateExpression: "SET #yjs = :state, #ts = :now, #ttl = :exp",
          ExpressionAttributeNames: {
            "#yjs": "yjsState",
            "#ts": "updatedAt",
            "#ttl": "expiresAt",
          },
          ExpressionAttributeValues: marshall({
            ":state": Buffer.from(state),
            ":now": new Date().toISOString(),
            ":exp": expiresAt,
          }),
        })
      )
    } catch (err) {
      logger.error({ sessionId, err }, "DynamoDB saveSessionState failed")
      throw err
    }
  }

  async createSession(session: SessionRecord): Promise<void> {
    try {
      await client.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: marshall(session, { removeUndefinedValues: true }),
          ConditionExpression: "attribute_not_exists(sessionId)",
        })
      )
    } catch (err) {
      logger.error({ sessionId: session.sessionId, err }, "DynamoDB createSession failed")
      throw err
    }
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    try {
      const result = await client.send(
        new GetItemCommand({
          TableName: TABLE,
          Key: marshall({ sessionId }),
        })
      )
      if (!result.Item) return null
      const item = unmarshall(result.Item)
      const { yjsState: _, ...metadata } = item
      return metadata as SessionRecord
    } catch (err) {
      logger.error({ sessionId, err }, "DynamoDB getSession failed")
      throw err
    }
  }

  async updateSessionLanguage(sessionId: string, language: string): Promise<void> {
    const now = new Date().toISOString()
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: TABLE,
          Key: marshall({ sessionId }),
          UpdateExpression: "SET #lang = :lang, #ts = :now",
          ExpressionAttributeNames: {
            "#lang": "language",
            "#ts": "updatedAt",
          },
          ExpressionAttributeValues: marshall({
            ":lang": language,
            ":now": now,
          }),
        })
      )
    } catch (err) {
      logger.error({ sessionId, err }, "DynamoDB updateSessionLanguage failed")
      throw err
    }
  }
}