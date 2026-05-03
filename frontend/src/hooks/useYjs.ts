import { useEffect, useRef } from "react";
import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

type UseYjsOptions = {
  sessionId: string;
  wsUrl: string;
  onStatusChange?: (status: "connected" | "connecting" | "disconnected") => void;
};

export function useYjs({ sessionId, wsUrl, onStatusChange }: UseYjsOptions) {
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);
  const undoRef = useRef<Y.UndoManager | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(wsUrl, sessionId, doc);
    providerRef.current = provider;
    docRef.current = doc;
    onStatusChange?.("connecting");

    const statusHandler = (event: { status: "connected" | "connecting" | "disconnected" }) => {
      onStatusChange?.(event.status);
    };

    provider.on("status", statusHandler);

    return () => {
      provider.off("status", statusHandler);
      bindingRef.current?.destroy();
      provider.destroy();
      doc.destroy();
      bindingRef.current = null;
      providerRef.current = null;
      docRef.current = null;
      undoRef.current = null;
      onStatusChange?.("disconnected");
    };
  }, [onStatusChange, sessionId, wsUrl]);

  const bindEditor = (editor: any, monaco: any) => {
    const doc = docRef.current;
    const provider = providerRef.current;
    if (!doc || !provider) {
      return;
    }

    bindingRef.current?.destroy();
    const yText = doc.getText("content");
    const model = editor.getModel();
    if (!model) {
      return;
    }

    undoRef.current = new Y.UndoManager(yText);
    bindingRef.current = new MonacoBinding(
      yText,
      model,
      new Set([editor]),
      provider.awareness
    );

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      undoRef.current?.undo();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
      undoRef.current?.redo();
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ, () => {
      undoRef.current?.redo();
    });
  };

  return { bindEditor };
}
