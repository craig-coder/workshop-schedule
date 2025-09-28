import React from "react";
import "./App.css";

const SYNC_URL = "/api/sheets";

const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091";

// helper to convert Google Sheet link -> CSV
function toCsvUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets/")) {
      const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = m ? m[1] : null;
      const gid = url.searchParams.get("gid") || "0";
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
  } catch (_) {}
  return input;
}

// parse CSV
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  function tokenize(line: string) {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  const headers = tokenize(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let j = 1; j < lines.length; j++) {
    const cells = tokenize(lines[j]);
    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = cells[k] ?? "";
    rows.push(obj);
  }
  return { headers, rows };
}

// section + subtask map
const SECTION_DEFS: Record<string, string[]> = {
  Draw: ["Cabinets Drawn", "Fronts Drawn"],
  Order: ["LDL", "Handles", "Decormax", "Hafele", "Consumables Check", "Misc"],
  CNC: ["Fronts", "Cabinets"],
  Edging: ["Fronts", "Cabinets"],
  Joinery: ["End Dominos", "Angles Cut", "Drawer Packs", "Other"],
  Prime: ["Prep", "Side 1", "Side 2"],
  "Top Coat": ["Prep 1", "Side 1.1", "Side 2.1", "Prep 2", "Side 2.2", "Side 2.2"],
  "Wrap & Pack": ["Fronts Packed", "Cabinets Packed", "Fitters Kit Packed", "Rails Cut", "Loaded"],
  Remedials: [],
  "Job Complete": [],
};

const STAGE_COLUMNS = Object.keys(SECTION_DEFS);

export default function App() {
  const [sheetUrl, setSheetUrl] = React.useState(DEFAULT_SHEET_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<{ job: string; stage: string } | null>(null);
  const [progress, setProgress] = React.useState<Record<string, any>>({});

  async function loadSheet() {
    try {
      setLoading(true);
      const url = toCsvUrl(sheetUrl);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch failed: " + res.status);
      const text = await res.text();
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadSheet();
  }, []);

  function getJobKey(r: Record<string, string>) {
    return (r["Client"] || r["Job"] || "").trim();
  }

  function getStageProgress(jobKey: string, stage: string) {
    const subs = SECTION_DEFS[stage] || [];
    let done = 0,
      started = 0;
    const map: Record<string, { status: string }> = {};
    subs.forEach((s) => {
      const st = progress[jobKey]?.[stage]?.[s] || "none";
      map[s] = { status: st };
      if (st === "done") done++;
      if (st === "progress" || st === "done") started++;
    });
    const total = subs.length;
    const state =
      done === total && total > 0 ? "complete" : started > 0 ? "partial" : "none";
    return { subs: map, state };
  }

  function setSubStatus(jobKey: string, stage: string, sub: string, status: string) {
    setProgress((prev) => {
      const next = { ...(prev[jobKey] || {}) };
      const stageData = next[stage] || {};
      stageData[sub] = status;
      next[stage] = stageData;
      return { ...prev, [jobKey]: next };
    });
    pushUpdate({ job: jobKey, stage, subtask: sub, status });
  }

  async function pushUpdate(payload: any) {
    try {
      const res = await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      console.log("[pushUpdate] ok:", j);
    } catch (e) {
      console.error("[pushUpdate] failed:", e);
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  return (
    <div className="app">
      <h2>Workshop Schedule — Tri-state checklists</h2>
      <p>Click any stage button to open its sub-tasks. Orange = in progress, Green = complete.</p>

      <div style={{ marginBottom: 12 }}>
        <input
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
          style={{ width: "60%" }}
        />
        <button onClick={loadSheet} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div style={{ color: "red" }}>{error}</div>}

      <input
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 12, padding: 6, width: 240 }}
      />

      <table className="jobs">
        <thead>
          <tr>
            <th>Client</th>
            <th>Link to Folder</th>
            <th>Days Until Delivery</th>
            <th>Stages</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r, i) => {
            const jobKey = getJobKey(r);
            return (
              <tr key={i}>
                <td>{jobKey}</td>
                <td>
                  {r["Link to Folder"] ? (
                    <a href={r["Link to Folder"]} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{r["Days Until Delivery"]}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {STAGE_COLUMNS.map((stage) => {
                      const { state } = getStageProgress(jobKey, stage);
                      const cls =
                        state === "complete"
                          ? "cell-done"
                          : state === "partial"
                          ? "cell-progress"
                          : "cell-none";
                      return (
                        <div key={stage} style={{ flex: "0 0 auto" }}>
                          <button
                            className={cls}
                            onClick={() =>
                              setOpen(
                                open && open.job === jobKey && open.stage === stage
                                  ? null
                                  : { job: jobKey, stage }
                              )
                            }
                          >
                            {stage}
                          </button>
                          {open && open.job === jobKey && open.stage === stage && (
                            <div className="subs">
                              {SECTION_DEFS[stage].map((s) => {
                                const st =
                                  progress[jobKey]?.[stage]?.[s] || "none";
                                const subCls =
                                  st === "done"
                                    ? "sub cell-done"
                                    : st === "progress"
                                    ? "sub cell-progress"
                                    : "sub";
                                return (
                                  <div
                                    key={s}
                                    className={subCls}
                                    onClick={() =>
                                      setSubStatus(
                                        jobKey,
                                        stage,
                                        s,
                                        st === "none"
                                          ? "progress"
                                          : st === "progress"
                                          ? "done"
                                          : "none"
                                      )
                                    }
                                  >
                                    {s}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
