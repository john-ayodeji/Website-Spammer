// public/worker.js
// Web Worker that issues fetches at approximately rps rate for a fixed number of requests.
// NOTE: Browser fetch is used; cross-origin targets must accept the request (CORS).
let stopped = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.cmd === "start") {
    stopped = false;
    const { id, url, requests, rps } = msg;
    // interval between requests in ms to aim for rps per worker
    const intervalMs = Math.max(1, Math.floor(1000 / Math.max(1, rps)));
    let sent = 0;
    for (let i = 0; i < requests; i++) {
      if (stopped) break;
      const start = Date.now();
      try {
        const resp = await fetch(url, { method: "GET", mode: "cors", cache: "no-store" });
        const elapsed = Date.now() - start;
        let snippet = "";
        try {
          const text = await resp.text();
          snippet = text.slice(0, 300);
        } catch (e) {
          snippet = "[no-text]";
        }
        self.postMessage({
          event: "row",
          payload: {
            timestamp: new Date().toISOString(),
            workerId: id,
            statusCode: resp.status,
            timeMs: elapsed,
            snippet,
            error: resp.status >= 400
          }
        });
      } catch (err) {
        const elapsed = Date.now() - start;
        self.postMessage({
          event: "row",
          payload: {
            timestamp: new Date().toISOString(),
            workerId: id,
            statusCode: null,
            timeMs: elapsed,
            snippet: (err && err.message) ? err.message.slice(0, 300) : "error",
            error: true
          }
        });
      }
      sent++;
      // wait to honor target rps
      const elapsedLoop = Date.now() - start;
      const wait = intervalMs - elapsedLoop;
      if (wait > 0) await sleep(wait);
      // yield occasionally
      if (sent % 50 === 0) await sleep(0);
    }
    self.postMessage({ event: "done", payload: { workerId: id, sent } });
  } else if (msg.cmd === "stop") {
    stopped = true;
    self.postMessage({ event: "stopped" });
  }
};
