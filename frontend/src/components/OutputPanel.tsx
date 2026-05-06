import type { OutputLine } from "../hooks/useExecution";

type OutputPanelProps = {
  lines: OutputLine[];
  error: string | null;
  running?: boolean;
  onClear?: () => void;
  onRetry?: () => void;
};

export function OutputPanel({ lines, error, running = false, onClear, onRetry }: OutputPanelProps) {
  return (
    <section className="output-panel">
      <div className="panel-title">
        <h3>Output</h3>
        <div className="output-toolbar">
          {running ? <span className="spinner-label">Running...</span> : null}
          {error && onRetry ? (
            <button type="button" className="toolbar-btn" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {onClear ? (
            <button type="button" className="toolbar-btn subtle" onClick={onClear}>
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <div className="output-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="output-stream ansi-ready">
        {lines.length === 0 && !error ? (
          <pre className="output-pre">
            <code>
              {running
                ? "$ Executing..."
                : "$ Run output will appear here. Empty sessions are expected before first run."}
            </code>
          </pre>
        ) : (
          lines.map((line, i) => {
            if (line.kind === "image") {
              return (
                <div key={i} className="output-image-wrap">
                  <img src={line.src} alt="Program output" className="output-image" />
                </div>
              );
            }
            if (line.kind === "meta") {
              return (
                <pre key={i} className="output-pre output-meta">
                  <code>{line.text}</code>
                </pre>
              );
            }
            const cls =
              line.kind === "err" ? "output-line output-stderr" : "output-line output-stdout";
            return (
              <pre key={i} className={cls}>
                <code>{line.text}</code>
              </pre>
            );
          })
        )}
      </div>
    </section>
  );
}
