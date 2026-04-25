// Session and document types
export interface Session {
  id: string;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  isPublic: boolean;
  code: string;
  yDocState: Uint8Array;
}

export interface SessionMetadata {
  id: string;
  name: string;
  language: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

// Code execution types
export interface RunRequest {
  sessionId: string;
  code: string;
  language: string;
  stdin?: string;
  timeout?: number;
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
  sessionId: string;
}

export interface TranslationResult {
  id: string;
  sessionId: string;
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

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}
