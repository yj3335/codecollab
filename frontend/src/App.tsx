import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { EditorPanel, type EditorPanelHandle } from "./components/EditorPanel";
import { OutputPanel } from "./components/OutputPanel";
import { SessionBar } from "./components/SessionBar";
import { TranslationDiffView } from "./components/TranslationDiffView";
import { useExecution } from "./hooks/useExecution";
import { useSession } from "./hooks/useSession";
import {
  getSession,
  patchSessionLanguage,
  postTranslate,
  type TranslationResult,
} from "./lib/api";

function SessionWorkspace() {
  const { sessionId = "" } = useParams();
  const editorRef = useRef<EditorPanelHandle>(null);
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected" | "idle"
  >("idle");
  const [sessionLanguage, setSessionLanguage] = useState(
    process.env.REACT_APP_DEFAULT_LANGUAGE ?? "python"
  );
  const [diffOpen, setDiffOpen] = useState(false);
  const [pendingTranslation, setPendingTranslation] = useState<TranslationResult | null>(null);

  const {
    activeSessionId,
    isCreatingSession,
    onCreateSession,
    onCopyShareUrl,
    shareUrl,
  } = useSession(sessionId);

  const { lines, running, error, run, clear } = useExecution();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSession(activeSessionId);
        if (!cancelled) {
          setSessionLanguage(s.language);
        }
      } catch {
        if (!cancelled) {
          setSessionLanguage(process.env.REACT_APP_DEFAULT_LANGUAGE ?? "python");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const handleTranslateRequest = async (code: string) => {
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
      console.error(e);
      window.alert(e instanceof Error ? e.message : "Translation failed");
    }
  };

  const handleAcceptTranslation = async () => {
    if (!pendingTranslation) {
      return;
    }
    try {
      await patchSessionLanguage(activeSessionId, pendingTranslation.targetLanguage);
      editorRef.current?.applyCode(pendingTranslation.translatedCode);
      setSessionLanguage(pendingTranslation.targetLanguage);
      setDiffOpen(false);
      setPendingTranslation(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed to apply translation");
    }
  };

  const handleDismissTranslation = () => {
    setDiffOpen(false);
    setPendingTranslation(null);
  };

  return (
    <div className="app-shell">
      <SessionBar
        sessionId={activeSessionId}
        shareUrl={shareUrl}
        isCreatingSession={isCreatingSession}
        statusLabel={connectionStatus}
        onCreateSession={onCreateSession}
        onCopyShareUrl={onCopyShareUrl}
      />
      <main className="workspace-grid">
        <EditorPanel
          ref={editorRef}
          sessionId={activeSessionId}
          language={sessionLanguage}
          onConnectionStatusChange={setConnectionStatus}
          onRunRequest={(code) => void run(code, activeSessionId, sessionLanguage)}
          onTranslateRequest={(code) => void handleTranslateRequest(code)}
          runDisabled={running}
          translateDisabled={running || diffOpen}
        />
        <section className="side-panels">
          <OutputPanel lines={lines} error={error} onClear={clear} />
          <TranslationDiffView
            open={diffOpen}
            original={pendingTranslation?.originalCode ?? ""}
            modified={pendingTranslation?.translatedCode ?? ""}
            originalLanguage={pendingTranslation?.sourceLanguage ?? sessionLanguage}
            modifiedLanguage={pendingTranslation?.targetLanguage ?? "javascript"}
            explanation={pendingTranslation?.explanation}
            onAccept={() => void handleAcceptTranslation()}
            onDismiss={handleDismissTranslation}
          />
        </section>
      </main>
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
