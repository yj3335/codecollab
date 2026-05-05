# translation

AWS Lambda that translates code between programming languages using the Gemini API.

## Endpoint

Routed via ALB: `POST /translate`

```json
{
  "code": "print('hello world')",
  "sourceLang": "python",
  "targetLang": "javascript",
  "sessionId": "optional-session-id"
}
```

Response:

```json
{
  "translatedCode": "console.log('hello world');",
  "notes": "Direct equivalent — no semantic gaps."
}
```

## Features

- Idiomatic translation (not line-by-line): Python list comprehensions → `Array.map()`, f-strings → template literals, etc.
- In-memory rate limiting: 5 requests/min per `sessionId` (resets on cold start)
- Exponential backoff on Gemini 429/503: 1s → 2s → 4s, max 3 retries
- CORS headers on all responses
- Gemini API key stored in AWS Secrets Manager (`codecollab/gemini-api-key`), cached per Lambda instance

## Model

`gemini-2.5-flash` via the `v1beta` Generative Language API. Thinking mode is disabled (`thinkingBudget: 0`) to stay within the 30s call timeout.

## Local setup

```bash
cd translation
npm install
npx tsc --noEmit   # type-check
```

## Deploy

Infrastructure is managed from `infra/` — the Lambda is part of `CodeCollab-DataStack`.

```bash
cd infra
npx cdk deploy CodeCollab-DataStack
```

Before first deploy, store the Gemini API key (get a free key at aistudio.google.com):

```bash
aws secretsmanager create-secret \
  --name codecollab/gemini-api-key \
  --region us-east-1 \
  --secret-string '{"apiKey":"YOUR_KEY_HERE"}'
```
