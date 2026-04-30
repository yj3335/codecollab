import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from "aws-lambda";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function ok(body: unknown): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function error(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ error: message }),
  };
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return error(405, "Method not allowed");
  }

  let body: { code?: string; sourceLang?: string; targetLang?: string };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "Invalid JSON body");
  }

  const { code, sourceLang, targetLang } = body;
  if (!code || !sourceLang || !targetLang) {
    return error(400, "Missing required fields: code, sourceLang, targetLang");
  }

  return ok({
    translatedCode:
      "// Translated code placeholder\nconsole.log('hello world');",
    notes: "Mock translation — Gemini integration coming Week 2",
  });
};
