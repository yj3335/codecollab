type SessionBarProps = {
  sessionId: string;
  shareUrl: string;
  statusLabel: "connected" | "connecting" | "disconnected" | "idle";
  isCreatingSession: boolean;
  onCreateSession: () => void;
  onCopyShareUrl: () => void;
};

export function SessionBar({
  sessionId,
  shareUrl,
  statusLabel,
  isCreatingSession,
  onCreateSession,
  onCopyShareUrl,
}: SessionBarProps) {
  return (
    <header className="session-bar">
      <div className="session-meta">
        <span className="session-label">Session</span>
        <code className="session-id">{sessionId}</code>
      </div>
      <div className="session-actions">
        <button type="button" onClick={onCreateSession} disabled={isCreatingSession}>
          {isCreatingSession ? "Creating..." : "New Session"}
        </button>
        <button type="button" onClick={onCopyShareUrl}>
          Copy Share URL
        </button>
      </div>
      <div className="session-status">
        <span className={`status-dot status-${statusLabel}`} />
        <span>{statusLabel}</span>
      </div>
      <input type="text" readOnly value={shareUrl} aria-label="Share URL" />
    </header>
  );
}
