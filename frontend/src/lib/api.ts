import axios from "axios";

const apiBaseUrl = process.env.REACT_APP_COLLAB_API_URL ?? "http://localhost:4000";

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
});

type CreateSessionResponse =
  | { sessionId: string }
  | { id: string }
  | { uuid: string };

export async function createSession() {
  const response = await api.post<CreateSessionResponse>("/api/sessions", {});
  const id =
    "sessionId" in response.data
      ? response.data.sessionId
      : "id" in response.data
      ? response.data.id
      : response.data.uuid;

  return id;
}
