type SessionBarProps = {
  sessionId: string;
  shareUrl: string;
  statusLabel: "connected" | "connecting" | "disconnected" | "idle";
  statusMessage?: string | null;
  isCreatingSession: boolean;
  language: string;
  languageDisabled?: boolean;
  onLanguageChange: (language: string) => void;
  onCreateSession: () => void;
  onCopyShareUrl: () => void;
  bannerMessage?: string | null;
  bannerTone?: "error" | "warning" | "info";
  onDismissBanner?: () => void;
};

const SUPPORTED_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
];

export function SessionBar({
  sessionId,
  shareUrl,
  statusLabel,
  statusMessage,
  isCreatingSession,
  language,
  languageDisabled = false,
  onLanguageChange,
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
        <div className="session-language">
          <label htmlFor="session-language" className="session-label">
            Language
          </label>
          <select
            id="session-language"
            aria-label="Session language"
            value={language}
            disabled={languageDisabled}
            onChange={(event) => onLanguageChange(event.target.value)}
          >
            {SUPPORTED_LANGUAGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
