import React from "react";

/** URLs **/
const APP_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyha1bpsQm0lBQU5tJE0L4vCEd8yJlJNFoZF5b5PqZMudb9RlF8Run7JYMFzw2OSWQGIQ/exec";

const DEFAULT_TRACKER_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/gviz/tq?tqx=out:csv&gid=270301091";

/** CSV parsing **/
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
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
      } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur);
    return out;
  };

  const headers = tokenize(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let j = 1; j < lines.length; j++) {
    const cells = tokenize(lines[j]);
    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = (cells[k] ?? "").trim();
    rows.push(obj);
  }
  return { headers, rows };
}

/** Detect "Stage - Subtask" columns and group them **/
type StageMap = Record<string, { header: string; subtask: string }[]>;

function buildStageMap(headers: string[]): StageMap {
  const map: StageMap = {};
  for (const h of headers) {
    const m = h.match(/^(.+?)\s*-\s*(.+)$/); // e.g. "CNC - Fronts Machined"
    if (!m) continue;
    const stage = m[1].trim();
    const sub   = m[2].trim();
    if (!map[stage]) map[stage] = [];
    map[stage].push({ header: h, subtask: sub });
  }
  // keep a consistent order
  for (const k of Object.keys(map)) {
    map[k].sort((a, b) => a.subtask.localeCompare(b.subtask));
  }
  return map;
}

/** Normalize a cell to tri-state string **/
function normalizeState(v: string): "none" | "progress" | "done" {
  const x = (v || "").trim().toLowerCase();
  if (x === "done") return "done";
  if (x === "progress") return "progress";
  return "none";
}

/** Tri-state toggle component **/
function TriState({ value, onChange }: { value: string; onChange: (v: "none"|"progress"|"done") => void }) {
  const val = normalizeState(value);
  const next = val === "none" ? "progress" : val === "progress" ? "done" : "none";

  const cls =
    val === "done"    ? "bg-green-500 border-green-600" :
    val === "progress"? "bg-orange-400 border-orange-500" :
                        "bg-white border-gray-300";

  const label =
    val === "done" ? "Done" :
    val === "progress" ? "In progress" : "Not started";

  return (
    <button
      onClick={() => onChange(next)}
      className="inline-flex items-center gap-2 px-2 py-1 border rounded-lg text-xs"
      title="Click to cycle state"
    >
      <span className={`inline-block w-4 h-4 rounded border ${cls}`} />
      <span>{label}</span>
    </button>
  );
}

/** Write one cell via Apps Script **/
async function setCell(job: string, column: string, value: "none"|"progress"|"done") {
  await fetch(APP_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: "cell:set", job, column, value, by: "webapp" }),
  });
}

/** MAIN APP **/
export default function App() {
  const [trackerUrl, setTrackerUrl] = React.useState(DEFAULT_TRACKER_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [stageMap, setStageMap] = React.useState<StageMap>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [openKey, setOpenKey] = React.useState<string>("");   // which Job row is expanded
  const [openStage, setOpenStage] = React.useState<string>(""); // which Stage is open

  const CORE_COLUMNS = ["Job", "Client", "Link to Folder"]; // show these up-front

  async function loadTracker() {
    try {
      setLoading(true);
      setError("");
      const res = await fetch(trackerUrl);
      if (!res.ok) throw new Error("Fetch failed: " + res.status);
      const text = await res.text();
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setStageMap(buildStageMap(parsed.headers));
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => { loadTracker(); }, []);

  // Polling so other devices' changes appear
  React.useEffect(() => {
    const id = window.setInterval(loadTracker, 15000);
    return () => window.clearInterval(id);
  }, [trackerUrl]);

  function getJobKey(r: Record<string,string>) {
    return (r["Job"] || "").trim();
  }

  function overallForRow(r: Record<string,string>) {
    const jobKey = getJobKey(r);
    if (!jobKey) return 0;
    let have = 0, done = 0;
    for (const stage of Object.keys(stageMap)) {
      for (const { header } of stageMap[stage]) {
        const s = normalizeState(r[header] || "");
        have++;
        if (s === "done") done++;
      }
    }
    if (!have) return 0;
    return Math.round((done / have) * 100);
  }

  function renderCoreCell(h: string, r: Record<string,string>) {
    if (h === "Link to Folder" && r[h]) {
      return (
        <a
          href={r[h]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          Open
        </a>
      );
    }
    return r[h] || "";
  }

  function renderStageButton(stage: string, r: Record<string,string>) {
    const jobKey = getJobKey(r);
    // derive quick state for the button color
    let total = 0, dn = 0, anyProgress = false;
    for (const { header } of stageMap[stage] || []) {
      const v = normalizeState(r[header] || "");
      total++; if (v === "done") dn++;
      if (v === "progress") anyProgress = true;
    }
    const complete = total > 0 && dn === total;
    const cls =
      complete ? "bg-green-50 border-green-600"
               : anyProgress ? "bg-orange-50 border-orange-500"
                             : "bg-white border-gray-300";
    const dot =
      complete ? "bg-green-500 border-green-600"
               : anyProgress ? "bg-orange-400 border-orange-500"
                             : "bg-white border-gray-300";

    const isOpen = openKey === jobKey && openStage === stage;
    return (
      <button
        key={stage}
        onClick={() => {
          setOpenKey(isOpen ? "" : jobKey);
          setOpenStage(isOpen ? "" : stage);
        }}
        className={`px-2 py-1 rounded-lg border flex items-center gap-2 ${cls}`}
      >
        <span className={`inline-block w-4 h-4 rounded border ${dot}`} />
        <span className="text-xs font-medium">{stage}</span>
      </button>
    );
  }

  async function updateSubtask(r: Record<string,string>, header: string, next: "none"|"progress"|"done") {
    const job = getJobKey(r);
    if (!job) return;
    // optimistic UI
    setRows(prev => prev.map(row => {
      if (getJobKey(row) !== job) return row;
      return { ...row, [header]: next };
    }));
    // write to Apps Script
    try {
      await setCell(job, header, next);
    } catch {
      // on error, reload from source to reconcile
      loadTracker();
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => Object.values(r).some(v => String(v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid gap-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Workshop Schedule — Tri-state checklists</h1>
            <p className="text-sm text-gray-600">Click any stage button to open its subtasks. Orange = in progress, Green = complete.</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input
              className="border rounded-lg px-3 py-2 w-[520px]"
              value={trackerUrl}
              onChange={(e) => setTrackerUrl(e.target.value)}
            />
            <button onClick={loadTracker} disabled={loading} className="px-3 py-2 rounded-lg bg-black text-white">
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </header>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <section className="bg-white rounded-2xl shadow p-4 grid gap-3">
          <div className="flex flex-wrap gap-3 items-center">
            <input
              className="border rounded-lg px-3 py-2 min-w-[240px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
            />
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow p-4">
          <div className="overflow-auto border rounded-xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {CORE_COLUMNS.map((h) => (
                    <th key={h} className="text-left px-3 py-3 border-b whitespace-nowrap">{h}</th>
                  ))}
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Stages</th>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Progress</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const jobKey = getJobKey(r);
                  const progressPct = overallForRow(r);
                  const stageButtons = Object.keys(stageMap).map((st) => renderStageButton(st, r));
                  const isOpen = openKey === jobKey && !!openStage;
                  return (
                    <React.Fragment key={i}>
                      <tr className="odd:bg-white even:bg-gray-50 border-b-2">
                        {CORE_COLUMNS.map((h) => (
                          <td key={h} className="px-3 py-3 border-b whitespace-nowrap">{renderCoreCell(h, r)}</td>
                        ))}
                        <td className="px-3 py-3 border-b whitespace-nowrap">
                          <div className="flex flex-wrap gap-2">{stageButtons}</div>
                        </td>
                        <td className="px-3 py-3 border-b min-w-[220px]">
                          <div className="w-48 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-3 bg-green-500" style={{ width: progressPct + "%" }} />
                          </div>
                          <div className="text-[11px] text-gray-600 mt-1">Overall {progressPct}%</div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={CORE_COLUMNS.length + 2} className="bg-gray-50">
                            <div className="p-3 grid gap-3">
                              <div className="text-sm font-medium">{r["Job"] || "Job"} — {openStage}</div>
                              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                {(stageMap[openStage] || []).map(({ header, subtask }) => {
                                  const val = normalizeState(r[header] || "");
                                  return (
                                    <div key={header} className="bg-white border rounded-lg p-3 flex items-center justify-between gap-3">
                                      <span className="text-sm">{subtask}</span>
                                      <TriState
                                        value={val}
                                        onChange={(next) => updateSubtask(r, header, next)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { setOpenKey(""); setOpenStage(""); }}
                                  className="ml-auto px-3 py-1 rounded-lg border text-xs"
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
