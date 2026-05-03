import Editor from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { useYjs } from "../hooks/useYjs";

type EditorPanelProps = {
  sessionId: string;
  onConnectionStatusChange?: (
    status: "connected" | "connecting" | "disconnected"
  ) => void;
};

export function EditorPanel({ sessionId, onConnectionStatusChange }: EditorPanelProps) {
  const [status, setStatus] = useState<"connected" | "connecting" | "disconnected">(
    "connecting"
  );
  const wsUrl = useMemo(
    () => process.env.REACT_APP_COLLAB_WS_URL ?? "ws://localhost:8000",
    []
  );
  const { bindEditor } = useYjs({
    sessionId,
    wsUrl,
    onStatusChange: (nextStatus) => {
      setStatus(nextStatus);
      onConnectionStatusChange?.(nextStatus);
    },
  });

  const onMount = (editor: any, monaco: any) => {
    bindEditor(editor, monaco);
  };

  return (
    <section className="editor-panel" data-connection-status={status}>
      <div className="panel-title">
        <h2>Collaborative Editor</h2>
        <span className={`status-badge status-${status}`}>{status}</span>
      </div>
      <Editor
        height="62vh"
        language="python"
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
