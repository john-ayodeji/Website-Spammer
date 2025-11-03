// pages/index.js
import { useState, useRef, useEffect } from "react";

const MAX_REQS_PER_SEC = 1000;
const MAX_TOTAL_REQS = 100000;
const MAX_CONCURRENCY = 500;

export default function Home() {
  const [url, setUrl] = useState("");
  const [concurrency, setConcurrency] = useState(10);
  const [totalRequests, setTotalRequests] = useState(1000);
  const [targetRps, setTargetRps] = useState(200);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ sent: 0, errors: 0 });
  const workersRef = useRef([]);
  const nextId = useRef(0);

  // Enforce caps
  useEffect(() => {
    if (targetRps > MAX_REQS_PER_SEC) setTargetRps(MAX_REQS_PER_SEC);
    if (totalRequests > MAX_TOTAL_REQS) setTotalRequests(MAX_TOTAL_REQS);
    if (concurrency > MAX_CONCURRENCY) setConcurrency(MAX_CONCURRENCY);
  }, []);

  function startTest() {
    if (!url) return alert("Enter target URL");
    if (running) return;

    // sanitize values & enforce caps
    const c = Math.min(Math.max(1, Number(concurrency) || 1), MAX_CONCURRENCY);
    const trs = Math.min(Math.max(1, Number(totalRequests) || 1), MAX_TOTAL_REQS);
    const rps = Math.min(Math.max(1, Number(targetRps) || 1), MAX_REQS_PER_SEC);

    // compute per-worker rate
    const perWorkerRps = Math.max(1, Math.floor(rps / c));
    const estimatedTotalRps = perWorkerRps * c;

    if (!confirm(
      `About to start test:\nTarget: ${url}\nWorkers: ${c}\nTotal requests: ${trs}\nTarget RPS (global cap ${MAX_REQS_PER_SEC}): ${rps}\nEstimated RPS (per-worker floors): ${estimatedTotalRps}\n\nDo you confirm you own / have permission to test this site?`
    )) return;

    // reset
    setRows([]);
    nextId.current = 0;
    setSummary({ sent: 0, errors: 0 });
    setRunning(true);

    // spawn workers
    workersRef.current = [];
    const requestsPerWorker = Math.floor(trs / c);
    const remainder = trs % c;

    for (let i = 0; i < c; i++) {
      const assigned = requestsPerWorker + (i < remainder ? 1 : 0);
      const worker = new Worker("/worker.js");
      worker.postMessage({
        cmd: "start",
        id: i + 1,
        url,
        requests: assigned,
        rps: perWorkerRps
      });
      worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.event === "row") {
          pushRow(msg.payload);
        } else if (msg.event === "done") {
          // worker finished
        } else if (msg.event === "error") {
          pushRow(msg.payload);
        }
      };
      workersRef.current.push(worker);
    }
  }

  function stopTest() {
    workersRef.current.forEach(w => {
      try { w.postMessage({ cmd: "stop" }); } catch (e) { /*ignore*/ }
    });
    workersRef.current = [];
    setRunning(false);
  }

  function pushRow(r) {
    // limit stored rows to last 2000 to avoid memory blowup in UI
    setRows(prev => {
      const next = [r, ...prev];
      if (next.length > 2000) next.pop();
      return next;
    });
    setSummary(s => ({
      sent: s.sent + 1,
      errors: s.errors + (r.error ? 1 : 0)
    }));
    // auto-stop if reached total cap (defensive)
    if (summary.sent + 1 >= MAX_TOTAL_REQS) stopTest();
  }

  function exportCSV() {
    const header = ["timestamp,workerId,statusCode,timeMs,snippet,error"];
    const csv = rows.slice().reverse().map(r =>
      `${r.timestamp},${r.workerId},${r.statusCode || ""},${r.timeMs || ""},"${(r.snippet||"").replace(/"/g,'""')}",${r.error?1:0}`
    );
    const content = header.concat(csv).join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url_ = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url_;
    a.download = `loadtest_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url_);
  }

  return (
    <div style={{ padding: 20, fontFamily: "system-ui, -apple-system, Roboto, sans-serif" }}>
      <h1>Client-side Load Tester (Next.js)</h1>
      <p style={{ color: "#b33" }}>⚠️ Only test sites you own or have explicit permission to test.</p>

      <div style={{ display: "grid", gap: 8, maxWidth: 900 }}>
        <label>Target URL
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://staging.example.com/" style={{ width: "100%" }} />
        </label>

        <label>Concurrency (workers) — max {MAX_CONCURRENCY}
          <input type="number" value={concurrency} onChange={e => setConcurrency(e.target.value)} min="1" max={MAX_CONCURRENCY} />
        </label>

        <label>Total requests — max {MAX_TOTAL_REQS}
          <input type="number" value={totalRequests} onChange={e => setTotalRequests(e.target.value)} min="1" max={MAX_TOTAL_REQS} />
        </label>

        <label>Target global RPS (requests per second) — max {MAX_REQS_PER_SEC}
          <input type="number" value={targetRps} onChange={e => setTargetRps(e.target.value)} min="1" max={MAX_REQS_PER_SEC} />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={startTest} disabled={running}>Start</button>
          <button onClick={stopTest} disabled={!running}>Stop</button>
          <button onClick={exportCSV} disabled={rows.length===0}>Export CSV</button>
          <div style={{ marginLeft: "auto" }}>
            <strong>Sent:</strong> {summary.sent} &nbsp; <strong>Errors:</strong> {summary.errors}
          </div>
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>Live results (most recent first)</h3>
      <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #ddd" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f6f6f6" }}>
              <th>#</th><th>Timestamp</th><th>Worker</th><th>Status</th><th>Time (ms)</th><th>Snippet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{rows.length - i}</td>
                <td>{r.timestamp}</td>
                <td>{r.workerId}</td>
                <td style={{ color: r.error ? "crimson" : "inherit" }}>{r.error ? `ERR ${r.statusCode||""}` : r.statusCode}</td>
                <td>{r.timeMs}</td>
                <td style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>{r.snippet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
