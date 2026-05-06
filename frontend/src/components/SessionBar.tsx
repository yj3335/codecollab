type SessionBarProps = {
  sessionId: string;
  shareUrl: string;
  statusLabel: "connected" | "connecting" | "disconnected" | "idle";
  statusMessage?: string | null;
  isCreatingSession: boolean;
  onCreateSession: () => void;
  onCopyShareUrl: () => void;
  bannerMessage?: string | null;
  bannerTone?: "error" | "warning" | "info";
  onDismissBanner?: () => void;
};

export function SessionBar({
  sessionId,
  shareUrl,
  statusLabel,
  statusMessage,
  isCreatingSession,
  onCreateSession,
  onCopyShareUrl,
  bannerMessage,
  bannerTone = "info",
  onDismissBanner,
}: SessionBarProps) {
  return (
    <header className="session-shell">
      {bannerMessage ? (
        <div className={`session-banner session-banner-${bannerTone}`} role="alert">
          <span>{bannerMessage}</span>
          {onDismissBanner ? (
            <button type="button" className="banner-dismiss" onClick={onDismissBanner}>
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="session-bar">
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
          {statusMessage ? <small className="session-status-message">{statusMessage}</small> : null}
        </div>
        <input type="text" readOnly value={shareUrl} aria-label="Share URL" />
      </div>
    </header>
  );
}
