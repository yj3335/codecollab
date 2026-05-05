import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { buildSystemPrompt } from "./prompt";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Exponential backoff delays for Gemini 429 retries: 1s, 2s, 4s
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }> };
  }>;
}

// Module-level state — survives across warm invocations within the same instance.
const rateLimitMap = new Map<string, RateLimitEntry>();
let cachedApiKey: string | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function err(
  statusCode: number,
  message: string,
  extra?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra },
    body: JSON.stringify({ error: message }),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

// ── Rate limiting ─────────────────────────────────────────────────────────────

function checkRateLimit(sessionId: string): {
  allowed: boolean;
  retryAfter?: number;
} {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(sessionId, { count: 1, resetTime: now + 60_000 });
    return { allowed: true };
  }
  if (entry.count >= 5) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }
  entry.count++;
  return { allowed: true };
}

// ── Secrets Manager ───────────────────────────────────────────────────────────

async function getApiKey(): Promise<string> {
  if (cachedApiKey !== undefined) return cachedApiKey;
  const client = new SecretsManagerClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId:
        process.env.GEMINI_SECRET_NAME ?? "codecollab/gemini-api-key",
    })
  );
  if (!response.SecretString) throw new Error("Gemini secret has no string value");
  cachedApiKey = (JSON.parse(response.SecretString) as { apiKey: string }).apiKey;
  return cachedApiKey;
}

// ── Gemini API ────────────────────────────────────────────────────────────────

async function callGemini(
  apiKey: string,
  systemPrompt: string,
  code: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: code }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no text in response");
    return text;
  }

  throw new Error("Gemini rate limit exceeded after maximum retries");
}

function parseGeminiOutput(raw: string): {
  translatedCode: string;
  notes: string;
} {
  // Strip markdown fences that Gemini sometimes wraps around JSON despite instructions.
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  if (
    typeof parsed.translatedCode !== "string" ||
    typeof parsed.notes !== "string"
  ) {
    throw new Error("Response missing translatedCode or notes fields");
  }
  return { translatedCode: parsed.translatedCode, notes: parsed.notes };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return err(405, "Method not allowed");
  }

  let body: {
    code?: unknown;
    sourceLang?: unknown;
    targetLang?: unknown;
    sessionId?: unknown;
  } = {};
  try {
    body = JSON.parse(event.body ?? "{}") as typeof body;
  } catch {
    return err(400, "Invalid JSON body");
  }

  const { code, sourceLang, targetLang, sessionId } = body;
  if (
    typeof code !== "string" ||
    typeof sourceLang !== "string" ||
    typeof targetLang !== "string"
  ) {
    return err(400, "Missing required fields: code, sourceLang, targetLang");
  }

  const sid = typeof sessionId === "string" ? sessionId : "anonymous";
  const { allowed, retryAfter } = checkRateLimit(sid);
  if (!allowed) {
    return err(429, "Rate limit exceeded", {
      "Retry-After": String(retryAfter),
    });
  }

  try {
    const apiKey = await getApiKey();
    const systemPrompt = buildSystemPrompt(sourceLang, targetLang);
    const rawResponse = await callGemini(apiKey, systemPrompt, code);

    try {
      const result = parseGeminiOutput(rawResponse);
      return ok(result);
    } catch {
      return err(500, "Failed to parse translation response");
    }
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Translation failed", details }),
    };
  }
};
