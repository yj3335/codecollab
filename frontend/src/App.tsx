import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { OutputPanel } from "./components/OutputPanel";
import { SessionBar } from "./components/SessionBar";
import { TranslationDiffView } from "./components/TranslationDiffView";
import { useExecution } from "./hooks/useExecution";
import { useSession } from "./hooks/useSession";
import {
  ApiError,
  getSession,
  patchSessionLanguage,
  postTranslate,
  type TranslationResult,
} from "./lib/api";

function SessionNotFoundView({ onCreateSession }: { onCreateSession: () => void }) {
  return (
    <main className="workspace-grid">
      <section className="editor-panel">
        <div className="panel-title">
          <h2>Session not found</h2>
        </div>
        <div className="empty-state">
          <p>
            This session does not exist or has expired. Create a new session and share the fresh URL
            with collaborators.
          </p>
          <button type="button" className="toolbar-btn primary" onClick={onCreateSession}>
            Create new session
          </button>
        </div>
      </section>
    </main>
  );
}

function SessionWorkspace() {
  const { sessionId = "" } = useParams();
  const editorRef = useRef<EditorPanelHandle>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected" | "idle"
  >("idle");
  const [sessionLanguage, setSessionLanguage] = useState(
    process.env.REACT_APP_DEFAULT_LANGUAGE ?? "python"
  );
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionMissing, setSessionMissing] = useState(false);
  const [workspaceBanner, setWorkspaceBanner] = useState<string | null>(null);
  const [bannerTone, setBannerTone] = useState<"error" | "warning" | "info">("info");
  const [diffOpen, setDiffOpen] = useState(false);
  const [translationBusy, setTranslationBusy] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [pendingTranslation, setPendingTranslation] = useState<TranslationResult | null>(null);

  const {
    activeSessionId,
    createError,
    clearCreateError,
    isCreatingSession,
    onCreateSession,
    onCopyShareUrl,
    shareUrl,
  } = useSession(sessionId);

  const { lines, running, error, run, clear, rerun } = useExecution();

  useEffect(() => {
    if (createError) {
      setWorkspaceBanner(createError);
      setBannerTone("error");
    }
  }, [createError]);

  useEffect(() => {
    if (connectionStatus === "disconnected") {
      setWorkspaceBanner("Disconnected from collaboration server. Reconnecting automatically...");
      setBannerTone("warning");
      return;
    }
    if (connectionStatus === "connected" && bannerTone === "warning") {
      setWorkspaceBanner("Connection restored.");
      setBannerTone("info");
    }
  }, [bannerTone, connectionStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSessionLoading(true);
      setSessionMissing(false);
      try {
        const s = await getSession(activeSessionId);
        if (!cancelled) {
          setSessionLanguage(s.language);
          setWorkspaceBanner(null);
          clearCreateError();
        }
      } catch (error) {
        if (!cancelled) {
          setSessionLanguage(process.env.REACT_APP_DEFAULT_LANGUAGE ?? "python");
          if (error instanceof ApiError && error.kind === "not_found") {
            setSessionMissing(true);
          } else {
            setWorkspaceBanner(
              "Could not refresh session metadata. You can keep editing, but some actions may fail."
            );
            setBannerTone("warning");
          }
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const handleTranslateRequest = async (code: string) => {
    setTranslationBusy(true);
    setTranslationError(null);
    try {
      const targetLanguage = sessionLanguage === "python" ? "javascript" : "python";
      const result = await postTranslate({
        code,
        sourceLanguage: sessionLanguage,
        targetLanguage,
        sessionId: activeSessionId,
      });
      setPendingTranslation(result);
      setDiffOpen(true);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : "Translation failed. Please retry in a moment.";
      setTranslationError(msg);
      setWorkspaceBanner(msg);
      setBannerTone("error");
    } finally {
      setTranslationBusy(false);
    }
  };

  const handleAcceptTranslation = async () => {
    if (!pendingTranslation) {
      return;
    }
    setTranslationBusy(true);
    setTranslationError(null);
    try {
      await patchSessionLanguage(activeSessionId, pendingTranslation.targetLanguage);
      editorRef.current?.applyCode(pendingTranslation.translatedCode);
      setSessionLanguage(pendingTranslation.targetLanguage);
      setDiffOpen(false);
      setPendingTranslation(null);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : "Failed to apply translation right now.";
      setTranslationError(msg);
      setWorkspaceBanner(msg);
      setBannerTone("error");
    } finally {
      setTranslationBusy(false);
    }
  };

  const handleDismissTranslation = () => {
    setDiffOpen(false);
    setPendingTranslation(null);
    setTranslationError(null);
  };

  const statusMessage =
    connectionStatus === "disconnected"
      ? "Trying to reconnect"
      : connectionStatus === "connecting"
      ? "Sync in progress"
      : null;

  return (
    <div className="app-shell">
      <SessionBar
        sessionId={activeSessionId}
        shareUrl={shareUrl}
        isCreatingSession={isCreatingSession}
        statusLabel={connectionStatus}
        statusMessage={statusMessage}
        onCreateSession={onCreateSession}
        onCopyShareUrl={onCopyShareUrl}
        bannerMessage={workspaceBanner}
        bannerTone={bannerTone}
        onDismissBanner={() => {
          setWorkspaceBanner(null);
          clearCreateError();
        }}
      />
      {sessionMissing ? (
        <SessionNotFoundView onCreateSession={onCreateSession} />
      ) : (
        <main className="workspace-grid">
        <EditorPanel
          ref={editorRef}
          sessionId={activeSessionId}
          language={sessionLanguage}
          onConnectionStatusChange={setConnectionStatus}
          onRunRequest={(code) => {
            if (!code.trim()) {
              setWorkspaceBanner("Editor is empty. Add code before running.");
              setBannerTone("info");
              return;
            }
            void run(code, activeSessionId, sessionLanguage);
          }}
          onTranslateRequest={(code) => {
            if (!code.trim()) {
              setWorkspaceBanner("Editor is empty. Add code before translating.");
              setBannerTone("info");
              return;
            }
            void handleTranslateRequest(code);
          }}
          runDisabled={running || translationBusy || sessionLoading}
          translateDisabled={running || diffOpen || translationBusy || sessionLoading}
        />
        <section className="side-panels">
          <OutputPanel
            lines={lines}
            running={running}
            error={error}
            onClear={clear}
            onRetry={() => void rerun()}
          />
          <TranslationDiffView
            open={diffOpen}
            loading={translationBusy}
            original={pendingTranslation?.originalCode ?? ""}
            modified={pendingTranslation?.translatedCode ?? ""}
            originalLanguage={pendingTranslation?.sourceLanguage ?? sessionLanguage}
            modifiedLanguage={pendingTranslation?.targetLanguage ?? "javascript"}
            explanation={translationError ?? pendingTranslation?.explanation}
            onAccept={() => void handleAcceptTranslation()}
            onDismiss={handleDismissTranslation}
          />
        </section>
        </main>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/s/${crypto.randomUUID()}`} replace />} />
      <Route path="/s/:sessionId" element={<SessionWorkspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
