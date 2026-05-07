// Session and document types
export interface Session {
  sessionId: string;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  isPublic: boolean;
  expiresAt?: number;
}

export interface SessionMetadata {
  sessionId: string;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  isPublic: boolean;
}

// Code execution types
export interface RunRequest {
  sessionId: string;
  code: string;
  language: "python" | "javascript";
  stdin?: string;
  timeout?: number;
}

// Initial response from POST /api/run (async kickoff)
export interface RunAck {
  runId: string;
  status: "queued" | "running";
}

export interface RunResult {
  id: string;
  sessionId: string;
  code: string;
  language: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  timestamp: string;
}

export interface StreamEvent {
  type: "start" | "stdout" | "stderr" | "complete" | "error";
  data: string;
  timestamp: string;
}

// Translation types
export interface TranslationRequest {
  code: string;
  sourceLanguage: string;
  targetLanguage: string;
  sessionId?: string;
}

export interface TranslationResult {
  id: string;
  sessionId?: string;
  sourceLanguage: string;
  targetLanguage: string;
  originalCode: string;
  translatedCode: string;
  explanation?: string;
  timestamp: string;
}

// User session types
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

// API response wrapper used by collab-server, execution-api, and translation Lambda
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}
