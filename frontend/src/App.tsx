import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { useState } from "react";
import { EditorPanel } from "./components/EditorPanel";
import { OutputPanel } from "./components/OutputPanel";
import { SessionBar } from "./components/SessionBar";
import { TranslationDiffView } from "./components/TranslationDiffView";
import { useSession } from "./hooks/useSession";

function SessionWorkspace() {
  const { sessionId = "" } = useParams();
  const [connectionStatus, setConnectionStatus] = useState<
    "connected" | "connecting" | "disconnected" | "idle"
  >("idle");
  const {
    activeSessionId,
    isCreatingSession,
    onCreateSession,
    onCopyShareUrl,
    shareUrl,
  } = useSession(sessionId);

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
          sessionId={activeSessionId}
          onConnectionStatusChange={setConnectionStatus}
        />
        <section className="side-panels">
          <OutputPanel />
          <TranslationDiffView />
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
