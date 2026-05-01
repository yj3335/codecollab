export function OutputPanel() {
  return (
    <section className="output-panel">
      <div className="panel-title">
        <h3>Output</h3>
        <span>Skeleton (ANSI-ready)</span>
      </div>
      <pre className="output-stream ansi-ready">
        <code>$ waiting for /api/run stream integration...</code>
      </pre>
    </section>
  );
}
