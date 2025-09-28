import { useEffect, useState } from "react";
import { getState, setState } from "../lib/sheetApi";
// TEMP DEBUG — remove later
console.log("VITE_SHEET_API:", import.meta?.env?.VITE_SHEET_API);
console.log("VITE_SYNC_URL:", import.meta?.env?.VITE_SYNC_URL);
export default function HeartbeatTest() {
  const [log, setLog] = useState([]);

  const addLog = (msg, data) => {
    setLog((prev) => [
      ...prev,
      msg + (data ? ": " + JSON.stringify(data) : ""),
    ]);
  };

  useEffect(() => {
    async function run() {
      try {
        addLog("Fetching initial state...");
        const state1 = await getState();
        addLog("State", state1);

        const deviceId = "vercel-" + Math.random().toString(36).slice(2, 6);
        addLog("Writing heartbeat for " + deviceId);
        const write = await setState(
          "heartbeat:" + deviceId,
          { ts: Date.now() },
          deviceId
        );
        addLog("Write result", write);

        const state2 = await getState();
        addLog("State after write", state2);
      } catch (err) {
        addLog("Error", err.message);
      }
    }
    run();
  }, []);

  return (
    <div>
      <h2>Workshop Sync Test</h2>
      <pre>{log.join("\n")}</pre>
    </div>
  );
}
