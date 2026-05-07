import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
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

const rateLimitMap = new Map<string, RateLimitEntry>();
let cachedApiKey: string | undefined;

const log = (msg: string, extra?: Record<string, unknown>): void =>
  console.log(JSON.stringify({ msg, ...extra, ts: Date.now() }));

function envelope<T>(statusCode: number, body: { success: boolean; data?: T; error?: string }, extraHeaders?: Record<string, string>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ ...body, statusCode }),
  };
}

const ok = <T>(data: T): APIGatewayProxyResult =>
  envelope(200, { success: true, data });

const fail = (statusCode: number, error: string, extraHeaders?: Record<string, string>): APIGatewayProxyResult =>
  envelope(statusCode, { success: false, error }, extraHeaders);

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

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
  // Per-session throttle: 10 req/min (per shared/contracts.md).
  if (entry.count >= 10) {
    return {
      allowed: false,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }
  entry.count++;
  return { allowed: true };
}

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

  const raw = response.SecretString.trim();
  // Accept either a JSON object { "apiKey": "..." } or a raw key string.
  let key: string;
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw) as { apiKey?: string };
    if (typeof parsed.apiKey !== "string") {
      throw new Error("Gemini secret JSON missing apiKey");
    }
    key = parsed.apiKey;
  } else {
    key = raw;
  }
  cachedApiKey = key;
  return key;
}

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
      log("translation.gemini_retry", { attempt, status: res.status, delayMs: RETRY_DELAYS_MS[attempt] });
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
  explanation: string;
} {
  // Strip markdown fences that Gemini sometimes wraps around JSON despite instructions.
  const stripped = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  const parsed = JSON.parse(stripped) as Record<string, unknown>;
  const translatedCode = parsed.translatedCode;
  // Accept both new ("explanation") and legacy ("notes") keys from Gemini output.
  const explanation = parsed.explanation ?? parsed.notes;
  if (typeof translatedCode !== "string" || typeof explanation !== "string") {
    throw new Error("Response missing translatedCode/explanation fields");
  }
  return { translatedCode, explanation };
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return fail(405, "Method not allowed");
  }

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return fail(400, "Invalid JSON body");
  }

  // Accept both new (sourceLanguage/targetLanguage) and legacy (sourceLang/targetLang) field names.
  const code = body.code;
  const sourceLanguage = body.sourceLanguage ?? body.sourceLang;
  const targetLanguage = body.targetLanguage ?? body.targetLang;
  const sessionId = body.sessionId;

  if (
    typeof code !== "string" ||
    typeof sourceLanguage !== "string" ||
    typeof targetLanguage !== "string"
  ) {
    return fail(
      400,
      "Missing required fields: code, sourceLanguage, targetLanguage"
    );
  }

  const sid = typeof sessionId === "string" ? sessionId : "anonymous";
  log("translation.request", {
    sessionId: sid,
    sourceLanguage,
    targetLanguage,
    codeLen: code.length,
  });

  const { allowed, retryAfter } = checkRateLimit(sid);
  if (!allowed) {
    log("translation.rate_limited", { sessionId: sid, retryAfter });
    return fail(429, "Rate limit exceeded", {
      "Retry-After": String(retryAfter),
    });
  }

  const start = Date.now();
  try {
    const apiKey = await getApiKey();
    const systemPrompt = buildSystemPrompt(sourceLanguage, targetLanguage);
    const rawResponse = await callGemini(apiKey, systemPrompt, code);

    let parsed: { translatedCode: string; explanation: string };
    try {
      parsed = parseGeminiOutput(rawResponse);
    } catch {
      log("translation.parse_error", { sessionId: sid, durationMs: Date.now() - start });
      return fail(500, "Failed to parse translation response");
    }

    const result = {
      id: randomUUID(),
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
      sourceLanguage,
      targetLanguage,
      originalCode: code,
      translatedCode: parsed.translatedCode,
      explanation: parsed.explanation,
      timestamp: new Date().toISOString(),
    };

    log("translation.success", {
      sessionId: sid,
      sourceLanguage,
      targetLanguage,
      durationMs: Date.now() - start,
    });
    return ok(result);
  } catch (e) {
    const details = e instanceof Error ? e.message : String(e);
    log("translation.error", { sessionId: sid, durationMs: Date.now() - start, details });
    return fail(500, `Translation failed: ${details}`);
  }
};
