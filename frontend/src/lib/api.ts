import axios from "axios";
import { getOrCreateOwnerId } from "./userIdentity";

const apiBaseUrl = process.env.REACT_APP_COLLAB_API_URL ?? "http://localhost:8000";
const executionBaseUrl =
  process.env.REACT_APP_EXECUTION_API_URL ?? "http://localhost:8001";

export const collabApi = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
});

const executionApi = axios.create({
  baseURL: executionBaseUrl,
  timeout: 120_000,
});

export type SessionRecord = {
  sessionId: string;
  name: string;
  language: string;
  ownerId: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
};

type CollabEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export class ApiError extends Error {
  kind: "not_found" | "network" | "timeout" | "server" | "validation" | "unknown";
  status?: number;

  constructor(
    message: string,
    kind: ApiError["kind"] = "unknown",
    status?: number
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

function toApiError(message: string, status?: number): ApiError {
  if (status === 404) return new ApiError(message, "not_found", status);
  if (status === 400 || status === 422) {
    return new ApiError(message, "validation", status);
  }
  if (typeof status === "number" && status >= 500) {
    return new ApiError(message, "server", status);
  }
  return new ApiError(message, "unknown", status);
}

function normalizeAxiosError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  if (!axios.isAxiosError(error)) {
    return new ApiError("Unexpected request failure", "unknown");
  }
  if (error.code === "ECONNABORTED") {
    return new ApiError("Request timed out. Please try again.", "timeout");
  }
  if (!error.response) {
    return new ApiError(
      "Network issue while contacting the service. Check connectivity and retry.",
      "network"
    );
  }
  const payload = error.response.data as { error?: string } | undefined;
  return toApiError(
    payload?.error ?? `Request failed (${error.response.status})`,
    error.response.status
  );
}

function unwrapCollab<T>(response: { status: number; data: unknown }, label: string): T {
  const envelope = response.data as CollabEnvelope<T>;
  if (response.status >= 400 || !envelope || typeof envelope !== "object") {
    const msg =
      envelope && "error" in envelope && typeof envelope.error === "string"
        ? envelope.error
        : `Request failed (${response.status})`;
    throw toApiError(msg, response.status);
  }
  if (!envelope.success || !("data" in envelope)) {
    throw toApiError(
      "error" in envelope && typeof envelope.error === "string"
        ? envelope.error
        : label,
      response.status
    );
  }
  return envelope.data;
}

export type CreateSessionBody = {
  name: string;
  language: string;
  ownerId: string;
  isPublic?: boolean;
};

export async function createSession(overrides?: Partial<CreateSessionBody>) {
  try {
    const body: CreateSessionBody = {
      name:
        overrides?.name ??
        process.env.REACT_APP_DEFAULT_SESSION_NAME ??
        "Untitled session",
      language:
        overrides?.language ?? process.env.REACT_APP_DEFAULT_LANGUAGE ?? "python",
      ownerId: overrides?.ownerId ?? getOrCreateOwnerId(),
      isPublic: overrides?.isPublic ?? false,
    };

    const response = await collabApi.post<CollabEnvelope<SessionRecord>>("/api/sessions", body, {
      validateStatus: () => true,
    });

    const data = unwrapCollab<SessionRecord>(response, "Failed to create session");
    const id = data.sessionId;
    if (!id) {
      throw new ApiError("Create session response missing sessionId", "unknown");
    }
    return id;
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

export async function getSession(sessionId: string): Promise<SessionRecord> {
  try {
    const response = await collabApi.get<CollabEnvelope<SessionRecord>>(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      { validateStatus: () => true }
    );
    return unwrapCollab<SessionRecord>(response, "Failed to load session");
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

export async function patchSessionLanguage(
  sessionId: string,
  language: string
): Promise<SessionRecord> {
  try {
    const response = await collabApi.patch<CollabEnvelope<SessionRecord>>(
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      { language },
      { validateStatus: () => true }
    );
    return unwrapCollab<SessionRecord>(response, "Failed to update session language");
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

export type RunRequest = {
  sessionId: string;
  code: string;
  language: string;
  stdin?: string;
  timeout?: number;
};

export type RunResult = {
  id: string;
  sessionId: string;
  code: string;
  language: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timestamp: string;
};

type ExecutionEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
};

export async function postRun(body: RunRequest): Promise<RunResult> {
  try {
    const response = await executionApi.post<ExecutionEnvelope<RunResult>>("/api/run", body, {
      validateStatus: () => true,
    });
    const env = response.data;
    if (response.status >= 400 || !env?.success || !env.data) {
      throw toApiError(env?.error ?? `Run failed (${response.status})`, response.status);
    }
    return env.data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

export type RunAck = {
  runId: string;
  streamUrl?: string;
  statusUrl?: string;
};

export async function postRunAsync(body: RunRequest): Promise<RunAck> {
  try {
    const response = await executionApi.post<ExecutionEnvelope<RunAck>>(
      "/api/run/async",
      body,
      { validateStatus: () => true }
    );
    const env = response.data;
    if (response.status >= 400 || !env?.success || !env.data) {
      throw toApiError(env?.error ?? `Run failed (${response.status})`, response.status);
    }
    return env.data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}

export type StreamEvent = {
  type: "start" | "stdout" | "stderr" | "complete" | "error";
  data: string;
  timestamp: string;
};

export function executionWsBaseUrl(): string {
  const base = executionBaseUrl.replace(/\/$/, "");
  return base.replace(/^http/, "ws");
}

export type TranslationRequest = {
  code: string;
  sourceLanguage: string;
  targetLanguage: string;
  sessionId: string;
};

export type TranslationResult = {
  id: string;
  sessionId: string;
  sourceLanguage: string;
  targetLanguage: string;
  originalCode: string;
  translatedCode: string;
  explanation?: string;
  timestamp: string;
};

export async function postTranslate(body: TranslationRequest): Promise<TranslationResult> {
  try {
    const response = await collabApi.post<CollabEnvelope<TranslationResult>>(
      "/api/translate",
      body,
      { validateStatus: () => true }
    );
    const data = unwrapCollab<TranslationResult>(response, "Translation failed");
    if (!data.translatedCode) {
      throw new ApiError("Translation response missing translatedCode", "unknown");
    }
    return data;
  } catch (error) {
    throw normalizeAxiosError(error);
  }
}
