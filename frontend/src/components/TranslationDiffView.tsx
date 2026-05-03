import { DiffEditor } from "@monaco-editor/react";

export function TranslationDiffView() {
  return (
    <section className="diff-panel">
      <div className="panel-title">
        <h3>Translation Diff</h3>
        <span>Disabled until Week 2</span>
      </div>
      <DiffEditor
        height="34vh"
        language="javascript"
        original={"# Python source appears here"}
        modified={"// JavaScript translation appears here"}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
        }}
      />
    </section>
  );
}
