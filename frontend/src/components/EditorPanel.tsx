import Editor from "@monaco-editor/react";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { useYjs } from "../hooks/useYjs";

export type EditorPanelHandle = {
  getCode: () => string;
  applyCode: (code: string) => void;
};

type EditorPanelProps = {
  sessionId: string;
  language: string;
  onConnectionStatusChange?: (
    status: "connected" | "connecting" | "disconnected"
  ) => void;
  onRunRequest?: (code: string) => void;
  onTranslateRequest?: (code: string) => void;
  runDisabled?: boolean;
  translateDisabled?: boolean;
};

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  function EditorPanel(
    {
      sessionId,
      language,
      onConnectionStatusChange,
      onRunRequest,
      onTranslateRequest,
      runDisabled = false,
      translateDisabled = false,
    },
    ref
  ) {
    const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">(
      "connecting"
    );
    const wsUrl = useMemo(
      () => process.env.REACT_APP_COLLAB_WS_URL ?? "ws://localhost:8000",
      []
    );
    const { bindEditor, getDocumentText, replaceDocumentText } = useYjs({
      sessionId,
      wsUrl,
      onStatusChange: (nextStatus) => {
        setStatus(nextStatus);
        onConnectionStatusChange?.(nextStatus);
      },
    });

    useImperativeHandle(
      ref,
      () => ({
        getCode: getDocumentText,
        applyCode: replaceDocumentText,
      }),
      [getDocumentText, replaceDocumentText]
    );

    const onMount = (editor: any, monaco: any) => {
      bindEditor(editor, monaco);
    };

    const handleRun = () => {
      onRunRequest?.(getDocumentText());
    };

    const handleTranslate = () => {
      onTranslateRequest?.(getDocumentText());
    };

    return (
      <section className="editor-panel" data-connection-status={status}>
        <div className="panel-title">
          <h2>Collaborative Editor</h2>
          <div className="editor-toolbar">
            <span className={`status-badge status-${status}`}>{status}</span>
            <button
              type="button"
              className="toolbar-btn"
              onClick={handleRun}
              disabled={runDisabled || !onRunRequest}
            >
              Run
            </button>
            <button
              type="button"
              className="toolbar-btn"
              onClick={handleTranslate}
              disabled={translateDisabled || !onTranslateRequest}
            >
              Translate
            </button>
          </div>
        </div>
        <Editor
          height="62vh"
          language={language}
          defaultValue="# Start coding collaboratively..."
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
          }}
          onMount={onMount}
        />
      </section>
    );
  }
);
