import { useCallback, useEffect, useRef } from "react";
import { MonacoBinding } from "y-monaco";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { colorFromString, getDisplayName, getOrCreateOwnerId } from "../lib/userIdentity";

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
  const yTextRef = useRef<Y.Text | null>(null);

  // Keep the latest callback in a ref so the connect effect below depends only
  // on the actual connection inputs (sessionId + wsUrl). If we put
  // onStatusChange in the deps, callers that pass an inline function would
  // change identity on every render, tear down the WebsocketProvider, and
  // immediately rebuild it — causing a connect/disconnect storm visible in
  // the collab-server logs.
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(wsUrl, sessionId, doc);
    providerRef.current = provider;
    docRef.current = doc;
    onStatusChangeRef.current?.("connecting");

    const ownerId = getOrCreateOwnerId();
    provider.awareness.setLocalStateField("user", {
      name: getDisplayName(),
      color: colorFromString(ownerId),
    });

    const statusHandler = (event: { status: "connected" | "connecting" | "disconnected" }) => {
      onStatusChangeRef.current?.(event.status);
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
      yTextRef.current = null;
      onStatusChangeRef.current?.("disconnected");
    };
  }, [sessionId, wsUrl]);

  const getDocumentText = useCallback(() => yTextRef.current?.toString() ?? "", []);

  const replaceDocumentText = useCallback((text: string) => {
    const yText = yTextRef.current;
    const ydoc = yText?.doc;
    if (!yText || !ydoc) {
      return;
    }
    ydoc.transact(() => {
      yText.delete(0, yText.length);
      yText.insert(0, text);
    });
  }, []);

  const bindEditor = (editor: any, monaco: any) => {
    const doc = docRef.current;
    const provider = providerRef.current;
    if (!doc || !provider) {
      return;
    }

    bindingRef.current?.destroy();
    const yText = doc.getText("content");
    yTextRef.current = yText;
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

  return { bindEditor, getDocumentText, replaceDocumentText };
}
