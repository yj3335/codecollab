import { DiffEditor } from "@monaco-editor/react";

type TranslationDiffViewProps = {
  open: boolean;
  original: string;
  modified: string;
  originalLanguage?: string;
  modifiedLanguage?: string;
  originalLabel?: string;
  modifiedLabel?: string;
  explanation?: string;
  onAccept: () => void;
  onDismiss: () => void;
};

export function TranslationDiffView({
  open,
  original,
  modified,
  originalLanguage = "python",
  modifiedLanguage = "javascript",
  originalLabel = "Source",
  modifiedLabel = "Translation",
  explanation,
  onAccept,
  onDismiss,
}: TranslationDiffViewProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="diff-panel">
      <div className="panel-title">
        <h3>Translation</h3>
        <span>
          {originalLabel} → {modifiedLabel}
        </span>
      </div>
      {explanation ? <div className="diff-notes">{explanation}</div> : null}
      <DiffEditor
        height="38vh"
        originalLanguage={originalLanguage}
        modifiedLanguage={modifiedLanguage}
        original={original}
        modified={modified}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
        }}
      />
      <div className="diff-actions">
        <button type="button" className="toolbar-btn subtle" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="toolbar-btn primary" onClick={onAccept}>
          Accept
        </button>
      </div>
    </section>
  );
}
