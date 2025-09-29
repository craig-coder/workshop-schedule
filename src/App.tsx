import React from "react";
import "./App.css";

/** === constants you already use === **/
const SYNC_URL = "/api/sheets";
const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091";

/** util: turn the visible Google Sheet URL into direct CSV */
function toCsvUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets/")) {
      const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = m ? m[1] : null;
      const gid = url.searchParams.get("gid") || "0";
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
  } catch {}
  return input;
}

/** tiny CSV parser (kept from your app) */
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  const tokenize = (line: string) => {
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
  };

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

// Stages + subtasks (3-state each)
const SECTION_DEFS: Record<string, string[]> = {
  Draw: ["Cabinets Drawn", "Fronts Drawn"],

  Order: ["LDL", "Handles", "Decormax", "Hafele", "Consumables Check", "Misc"],

  CNC: ["Fronts", "Cabinets"],
  Edging: ["Fronts", "Cabinets"],

  Joinery: ["End Dominos", "Angles Cut", "Drawer Packs", "Other"],

  Prime: ["Prep", "Side 1", "Side 2"],

  // ✅ fixed order — no duplicate "2.1"
  "Top Coat": ["Prep 1", "Side 1.1", "Side 2.1", "Prep 2", "Side 1.2", "Side 2.2"],

  "Wrap & Pack": ["Fronts Packed", "Cabinets Packed", "Fitters Kit Packed", "Rails Cut", "Loaded"],

  // Special cases (no subtasks):
  Remedials: [],          // Notes + single toggle
  "Job Complete": [],     // Computed only
};

const STAGE_COLUMNS = [
  "Draw",
  "Order",
  "CNC",
  "Edging",
  "Joinery",
  "Prime",
  "Top Coat",
  "Wrap & Pack",
  "Remedials",   // (Notes + Complete)
  "Job Complete" // (computed)
] as const;

/** local storage for client-side progress (unchanged) */
function useLocalProgress() {
  const key = "wff_progress_multi_stage_v3";
  const [state, setState] = React.useState<Record<string, any>>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      return {};
    }
  });
  React.useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [state]);
  return [state, setState] as const;
}

/** === NEW: heat color helper (red -> green) ===
 *  -14 days late   => red
 *  0               => yellowish
 *  +30 days out    => green
 */
function heatColor(days: number | null): string {
  if (days == null || isNaN(days as any)) return "hsl(220 10% 85%)"; // neutral grey
  const min = -14;
  const max = 30;
  const clamped = Math.max(min, Math.min(max, days));
  // map to hue: 0 (red) -> 120 (green)
  const hue = ((clamped - min) / (max - min)) * 120;
  return `hsl(${hue} 70% 70%)`;
}

/** NEW: pretty pill for Days Until Delivery */
function HeatCell({ days }: { days: number | null }) {
  const color = heatColor(days);
  return (
    <span className="heat" style={{ background: color, color: "#123", borderColor: "rgba(0,0,0,0.08)" }}>
      <span className="dot" style={{ color }} />
      {days == null || isNaN(days as any) ? "—" : `${days}d`}
    </span>
  );
}

/** get usable job key */
function getJobKeyFromRow(r: Record<string, string>) {
  // Prefer explicit job/client column named "Client" (your sheet)
  return (r["Client"] || r["client"] || r["Job"] || r["job"] || "").trim();
}

/** === helpers for statuses (non-sub stages) === */
type Status = "none" | "progress" | "done";
function cycleStatus(s?: Status): Status {
  if (!s || s === "none") return "progress";
  if (s === "progress") return "done";
  return "none";
}

/** ====== PROGRESS BAR + JOB PROGRESS HELPERS ====== */

/** Simple progress bar */
function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="progress" aria-label={`Progress ${pct}%`}>
      <div className="progress__track">
        <div className="progress__bar" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress__label">{pct}%</span>
    </div>
  );
}

/** per-stage completion ratio: 0..1 */
function stageCompletionRatio(
  jobKey: string,
  stage: string,
  getStageProgressFn: (jobKey: string, stage: string) => any
): number {
  if (stage === "Job Complete") return 0; // exclude from average
  const def = SECTION_DEFS[stage] || [];
  const prog = getStageProgressFn(jobKey, stage);

  // Single-stage (e.g., Remedials)
  if (def.length === 0) {
    const s = (prog as any).single?.status as Status | undefined;
    if (s === "done") return 1;
    if (s === "progress") return 0.5;
    return 0;
  }

  // Subtasked: use pct if available
  return (prog.pct ?? 0) / 100;
}

/** overall job progress: average across all stages except Job Complete */
function computeJobProgress(
  jobKey: string,
  getStageProgressFn: (jobKey: string, stage: string) => any
): number {
  const stages = STAGE_COLUMNS.filter((s) => s !== "Job Complete");
  if (stages.length === 0) return 0;
  const sum = stages.reduce((acc, s) => acc + stageCompletionRatio(jobKey, s, getStageProgressFn), 0);
  return (sum / stages.length) * 100;
}

/** === APP === */
export default function App() {
  const [sheetUrl, setSheetUrl] = React.useState(DEFAULT_SHEET_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [progress, setProgress] = useLocalProgress();

  /** NEW: zoom between 80% and 160% */
  const [zoom, setZoom] = React.useState(1);

  React.useEffect(() => {
    document.documentElement.style.setProperty("--zoom", String(zoom));
  }, [zoom]);

  async function loadSheet() {
    try {
      setError("");
      setLoading(true);
      const url = toCsvUrl(sheetUrl);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch failed: " + res.status);
      const text = await res.text();
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  React.useEffect(() => {
    loadSheet();
  }, []);

  /** stage progress calculator
   *  - For stages with subtasks: derive from subs
   *  - For single-stage toggles (e.g., Remedials): derive from stored status
   */
  function getStageProgress(jobKey: string, stage: string) {
    const stageDef = SECTION_DEFS[stage] || [];
    const s = progress[jobKey]?.[stage] ?? { subs: {} as Record<string, any>, status: "none", notes: "" };

    // If there are *no* subtasks, use single-stage status
    if (stageDef.length === 0 && stage !== "Job Complete") {
      const status = (s.status as Status) || "none";
      const state: "none" | "partial" | "complete" =
        status === "done" ? "complete" : status === "progress" ? "partial" : "none";
      const pct = status === "done" ? 100 : status === "progress" ? 50 : 0;
      return { subs: {}, pct, state, single: { status, notes: s.notes || "" } };
    }

    // Subtasked stages
    const names = stageDef;
    const map: Record<string, { status: Status; notes?: string }> = {};
    let done = 0,
      started = 0;
    for (const n of names) {
      const raw = s.subs?.[n];
      let status: Status = "none";
      let notes: string | undefined;
      if (raw && typeof raw === "object") {
        status = (raw.status as any) || "none";
        notes = raw.notes;
      } else if (raw === true) {
        status = "done";
      }
      map[n] = { status, notes };
      if (status === "done") done++;
      if (status === "progress" || status === "done") started++;
    }
    const total = names.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const state: "none" | "partial" | "complete" =
      done === total && total > 0 ? "complete" : started > 0 ? "partial" : "none";
    return { subs: map, pct, state };
  }

  function setSubStatus(r: Record<string, string>, stage: string, name: string, status: Status) {
    const job = getJobKeyFromRow(r);
    setProgress((prev: any) => {
      const cur = prev[job]?.[stage] ?? { subs: {} };
      const curItem = cur.subs?.[name] || { status: "none" };
      const next = { subs: { ...(cur.subs || {}), [name]: { status, notes: curItem.notes } } };
      return { ...prev, [job]: { ...(prev[job] || {}), [stage]: next } };
    });
    pushUpdate({ job, updatedBy: r["Assigned To"] || "Unknown", stage, subtask: name, status });
  }

  /** NEW: single-stage setter (e.g., Remedials status) */
  function setStageStatus(r: Record<string, string>, stage: string, status: Status) {
    const job = getJobKeyFromRow(r);
    setProgress((prev: any) => {
      const cur = prev[job]?.[stage] ?? {};
      const next = { ...(cur || {}), status };
      return { ...prev, [job]: { ...(prev[job] || {}), [stage]: next } };
    });
    pushUpdate({ job, updatedBy: r["Assigned To"] || "Unknown", stage, status });
  }

  /** NEW: Remedials notes setter */
  function setRemedialsNotes(r: Record<string, string>, text: string) {
    const stage = "Remedials";
    const job = getJobKeyFromRow(r);
    setProgress((prev: any) => {
      const cur = prev[job]?.[stage] ?? { status: "none" };
      const next = { ...cur, notes: text };
      return { ...prev, [job]: { ...(prev[job] || {}), [stage]: next } };
    });
    pushUpdate({ job, updatedBy: r["Assigned To"] || "Unknown", stage, notes: text });
  }

  /** NEW: computed job-complete check */
  function isStageComplete(jobKey: string, stage: string) {
    if (stage === "Job Complete") return true; // ignore self
    const def = SECTION_DEFS[stage] || [];
    const prog = getStageProgress(jobKey, stage);
    if (def.length === 0) {
      // single-stage (e.g., Remedials)
      return (prog as any).single?.status === "done";
    }
    return prog.state === "complete";
  }

  function computeJobComplete(jobKey: string) {
    // Require ALL stages except "Job Complete" to be complete (includes Remedials)
    return STAGE_COLUMNS.filter((s) => s !== "Job Complete").every((stage) => isStageComplete(jobKey, stage));
  }

  function statusButtonClass(state: "none" | "partial" | "complete") {
    return state === "complete" ? "cell-done" : state === "partial" ? "cell-progress" : "cell-none";
  }

  function stageButton(jobKey: string, r: Record<string, string>, stage: string) {
    const def = SECTION_DEFS[stage] || [];

    // 1) Job Complete (computed only)
    if (stage === "Job Complete") {
      const jc = computeJobComplete(jobKey);
      return (
        <div className={`computed-badge ${jc ? "green" : "clear"}`}>
          {jc ? "Complete" : "—"}
        </div>
      );
    }

    // 2) Single-stage (no subs) => toggle button (used by Remedials)
    if (def.length === 0) {
      const prog = getStageProgress(jobKey, stage);
      const current = (prog as any).single?.status as Status;
      const next = cycleStatus(current);
      const btnClass = statusButtonClass(prog.state);
      return (
        <button
          className={btnClass}
          onClick={() => setStageStatus(r, stage, next)}
          title={stage}
        >
          {stage}
        </button>
      );
    }

    // 3) Subtasked stages (existing behaviour)
    const prog = getStageProgress(jobKey, stage);
    const cls = statusButtonClass(prog.state);
    return (
      <details>
        <summary>
          <button className={cls}>{stage}</button>
        </summary>
        {/* subs only visible when opened */}
        <div className="subs">
          {def.map((name) => {
            const sub = (prog.subs as any)[name];
            const scls =
              sub?.status === "done"
                ? "sub cell-done"
                : sub?.status === "progress"
                ? "sub cell-progress"
                : "sub";
            const next =
              sub?.status === "done" ? "none" : sub?.status === "progress" ? "done" : "progress";
            return (
              <button
                key={name}
                className={scls}
                onClick={() => setSubStatus(r, stage, name, next as Status)}
              >
                {name}
              </button>
            );
          })}
        </div>
      </details>
    );
  }

  async function pushUpdate(payload: any) {
    try {
      await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* ignore */
    }
  }

  /** filter */
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  return (
    <div className="app">
      {/* toolbar */}
      <div className="toolbar">
        <input
          className="border rounded px-3 py-2 flex-1 min-w-[240px]"
          value={sheetUrl}
          onChange={(e) => setSheetUrl(e.target.value)}
        />
        <button onClick={loadSheet} disabled={loading} className="px-3 py-2 rounded bg-black text-white">
          {loading ? "Loading…" : "Refresh"}
        </button>

        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#555" }}>Zoom</label>
          <input
            className="range"
            type="range"
            min={0.8}
            max={1.6}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
          />
          <span style={{ fontSize: 12, color: "#555", width: 36, textAlign: "right" }}>{Math.round(zoom * 100)}%</span>
        </span>
      </div>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      <div className="mb-3">
        <input
          className="border rounded px-3 py-2 w-[360px] max-w-full"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
        />
      </div>

      <div className="overflow-auto border rounded-xl">
        <table className="jobs">
          <thead style={{ background: "#f8fafc" }}>
            <tr>
              <th>Client</th>
              <th>Link to Folder</th>
              <th>Days Until Delivery</th>

              {STAGE_COLUMNS.map((s) => {
                if (s === "Remedials") {
                  return (
                    <React.Fragment key="remedials-head">
                      <th>Remedials (Notes)</th>
                      <th>Remedials (Complete)</th>
                    </React.Fragment>
                  );
                }
                return <th key={s}>{s}</th>;
              })}
              <th>Progress</th> {/* NEW overall job progress */}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r, i) => {
              const jobKey = getJobKeyFromRow(r);
              // parse days as number (allow negatives)
              const daysRaw =
                r["Days Until Delivery"] ?? r["days until delivery"] ?? r["Days"] ?? r["Due"] ?? "";
              const days = daysRaw === "" ? null : Number(daysRaw);

              // remedials notes (from local state)
              const rem = (progress[jobKey]?.["Remedials"] ?? {}) as any;
              const remedialsNotes = rem.notes || "";

              return (
                <tr key={i}>
                  <td>{jobKey || "—"}</td>
                  <td>
                    {r["Link to Folder"] ? (
                      <a href={r["Link to Folder"]} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td><HeatCell days={isNaN(days as any) ? null : (days as number)} /></td>

                  {STAGE_COLUMNS.map((stage) => {
                    if (stage === "Remedials") {
                      return (
                        <React.Fragment key={`${jobKey}-remedials`}>
                          <td>
                            <textarea
                              className="notes-input"
                              placeholder="What needs doing…"
                              value={remedialsNotes}
                              onChange={(e) => setRemedialsNotes(r, e.target.value)}
                            />
                          </td>
                          <td>{stageButton(jobKey, r, "Remedials")}</td>
                        </React.Fragment>
                      );
                    }
                    return <td key={`${jobKey}-${stage}`}>{stageButton(jobKey, r, stage)}</td>;
                  })}

                  {/* NEW: overall job progress */}
                  <td>
                    <ProgressBar value={computeJobProgress(jobKey, getStageProgress)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-500">
        Sheet is the source of truth. Sub-task updates write to the <code>WorkshopJobState</code> tab and are
        pulled back every 15s (depending on your server code).
      </div>
    </div>
  );
}
