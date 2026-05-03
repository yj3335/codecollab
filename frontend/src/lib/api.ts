import axios from "axios";

const apiBaseUrl = process.env.REACT_APP_COLLAB_API_URL ?? "http://localhost:8000";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
});

export type CreateSessionBody = {
  name: string;
  language: string;
  ownerId: string;
  isPublic?: boolean;
};

type CreateSessionEnvelope =
  | {
      success: true;
      data: {
        sessionId?: string;
        id?: string;
        name?: string;
        language?: string;
        ownerId?: string;
        isPublic?: boolean;
        createdAt?: string;
        updatedAt?: string;
      };
    }
  | { success: false; error: string };

function getOrCreateOwnerId(): string {
  if (typeof window === "undefined") {
    return "local-dev";
  }
  const key = "codecollab_owner_id";
  let id = window.localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(key, id);
  }
  return id;
}

export async function createSession(overrides?: Partial<CreateSessionBody>) {
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

  const response = await api.post<CreateSessionEnvelope>("/api/sessions", body, {
    validateStatus: () => true,
  });

  const envelope = response.data;

  if (response.status >= 400 || !envelope || typeof envelope !== "object") {
    const msg =
      envelope && "error" in envelope && typeof envelope.error === "string"
        ? envelope.error
        : `Request failed (${response.status})`;
    throw new Error(msg);
  }

  if (!envelope.success || !("data" in envelope) || !envelope.data) {
    throw new Error(
      "error" in envelope && typeof envelope.error === "string"
        ? envelope.error
        : "Failed to create session"
    );
  }

  const id = envelope.data.sessionId ?? envelope.data.id;
  if (!id) {
    throw new Error("Create session response missing id");
  }

  return id;
}
