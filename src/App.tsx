import React from "react";

// ---- Server proxy (Vercel API -> Apps Script) ----
const SYNC_URL = "/api/sheets";

// Default = your workbook URL (used only to fetch the Tracker CSV)
const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091";

/* ---------------- CSV helpers (Tracker) ---------------- */
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
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
      } else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else { cur += ch; }
    }
    out.push(cur);
    return out;
  }

  const headers = tokenize(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let j = 1; j < lines.length; j++) {
    const cells = tokenize(lines[j]);
    const obj: Record<string, string> = {};
    for (let k = 0; k < headers.length; k++) obj[headers[k]] = cells[k] ?? "";
    rows.push(obj);
  }
  return { headers, rows };
}

/* ---------------- App config: stages + subtasks ---------------- */
const STAGE_COLUMNS = [
  "Draw","Order","CNC","Edging","Joinery","Prime","Top Coat","Wrap & Pack",
  "Remedials","Job Complete"
] as const;

// tweak these however you like later
const SECTION_DEFS: Record<string, string[]> = {
  Draw:        ["Cabinets Drawn","Fronts Drawn"],
  Order:       ["LDL Order","Decormax Order","Tikkurila Order","Fitters Kit Packed & Consumables Checked"],
  CNC:         ["Fronts Machined","Cabinets Machined"],
  Edging:      ["Cabinets Edged","Fronts Edged"],
  Joinery:     ["Door Panels Glued","Mitres Cut","Edge Dominos","Any Other Joinery Needed"],
  Prime:       ["Prep","Side 1","Side 2"],
  "Top Coat":  ["Prep","Side 1.1","Side 2.1","Prep","Side 1.2","Side 2.2"],
  "Wrap & Pack": ["Cabinets Wrapped","Rails Cut","Doors Wrapped","Fitters Kit Checked"],
  Remedials:   ["Snags Found","Snags Fixed","Revisit Booked"],
  "Job Complete": ["Client Sign-off","Photos Taken","Invoice Sent"],
};

/* ---------------- Local storage (optional) ---------------- */
function useLocalProgress() {
  const key = "wff_progress_multi_stage_v3";
  const [state, setState] = React.useState<Record<string, any>>(() => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; }
  });
  React.useEffect(() => { localStorage.setItem(key, JSON.stringify(state)); }, [state]);
  return [state, setState] as const;
}

/* ---------------- Component ---------------- */
export default function App() {
  const [sheetUrl, setSheetUrl] = React.useState(DEFAULT_SHEET_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");

  // Remote job-state pulled from Apps Script:
  // jobState[job][stage][subtask] = {status}
  const [jobState, setJobState] = React.useState<Record<string, any>>({});

  // UI state
  const [openKey, setOpenKey] = React.useState("");
  const [openStage, setOpenStage] = React.useState<string>("");

  // (kept but not required now)
  const [localProgress, setLocalProgress] = useLocalProgress();

  /* --------- Load Tracker CSV (list of jobs) --------- */
  async function loadSheet() {
    try {
      setError(""); setLoading(true);
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
  React.useEffect(() => { loadSheet(); }, []);

  /* --------- Keys & helpers --------- */
  function getJobKey(r: Record<string, string>) {
    // Use explicit job/client column from Tracker
    return (r["Client"] || r["client"] || r["Job"] || r["job"] || "").trim();
  }
  function getFolderUrl(r: Record<string, string>) {
    return (r["Link to Folder"] || r["link to folder"] || r["Folder"] || "").trim();
  }

  /* --------- Server sync helpers --------- */
  async function pullJob(jobKey: string) {
    try {
      const res = await fetch(`${SYNC_URL}?job=${encodeURIComponent(jobKey)}`);
      if (!res.ok) return { items: [] };
      const j = await res.json();
      if (Array.isArray(j?.items)) return { items: j.items };
      if (Array.isArray(j?.data))  return { items: j.data };
      return { items: [] };
    } catch {
      return { items: [] };
    }
  }

  function mergeRemoteIntoState(jobKey: string, items: any[]) {
    setJobState(prev => {
      const next = { ...(prev || {}) };
      const job = next[jobKey] || {};
      items.forEach(it => {
        const stage = it.stage;
        const sub   = it.subtask;
        const status = it.status || "none";
        const stageObj = job[stage] || {};
        stageObj[sub] = { status };
        job[stage] = stageObj;
      });
      next[jobKey] = job;
      return next;
    });
  }

  async function pushUpdate(payload: {
    job: string; stage: string; subtask: string; status: "none"|"progress"|"done"; updatedBy?: string;
  }) {
    try {
      await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // optimistic local merge so UI updates immediately
      mergeRemoteIntoState(payload.job, [{stage: payload.stage, subtask: payload.subtask, status: payload.status}]);
    } catch {}
  }

  /* --------- Stage progress calculators --------- */
  function getStageProgress(jobKey: string, stage: string) {
    const names = SECTION_DEFS[stage] || [];
    const stageObj = jobState?.[jobKey]?.[stage] || {};
    let done = 0, started = 0;
    const subs: Record<string, {status: "none"|"progress"|"done"}> = {};
    for (const n of names) {
      const st = stageObj[n]?.status || "none";
      subs[n] = { status: st };
      if (st === "done") done++;
      if (st === "progress" || st === "done") started++;
    }
    const total = names.length || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const state: "none"|"partial"|"complete" =
      (total > 0 && done === total) ? "complete" : (started > 0 ? "partial" : "none");
    return { subs, pct, state };
  }

  function getRowOverallPct(jobKey: string) {
    let total = 0, count = 0;
    for (const s of STAGE_COLUMNS) {
      if ((SECTION_DEFS[s] || []).length === 0) continue;
      total += getStageProgress(jobKey, s).pct;
      count++;
    }
    return count ? Math.round(total / count) : 0;
  }

  /* --------- Click handlers --------- */
  async function openChecklist(r: Record<string,string>, stage: string) {
    if (!SECTION_DEFS[stage]) { alert("No subtasks configured for " + stage); return; }
    const jobKey = getJobKey(r);
    setOpenKey(jobKey); setOpenStage(stage);
    const remote = await pullJob(jobKey);
    if (remote?.items?.length) mergeRemoteIntoState(jobKey, remote.items);
  }

  function setSubStatus(r: Record<string,string>, stage: string, name: string, status: "none"|"progress"|"done") {
    const jobKey = getJobKey(r);
    pushUpdate({ job: jobKey, updatedBy: r["Assigned To"] || "Unknown", stage, subtask: name, status });
  }

  /* --------- Polling sync --------- */
  React.useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    async function refreshAll() {
      for (const r of rows) {
        const job = getJobKey(r);
        if (!job) continue;
        const remote = await pullJob(job);
        if (!cancelled && remote?.items?.length) mergeRemoteIntoState(job, remote.items);
      }
    }
    const id = window.setInterval(refreshAll, 15000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [rows]);

  /* --------- Rendering helpers --------- */
  function StageButton({
    jobKey, stage, onClick
  }: { jobKey: string; stage: string; onClick: () => void }) {
    const st = getStageProgress(jobKey, stage);
    const cls =
      st.state === "complete" ? "bg-green-50 border-green-600" :
      st.state === "partial"  ? "bg-orange-50 border-orange-500" :
                                "bg-white border-gray-300";
    const dot =
      st.state === "complete" ? "bg-green-500 border-green-600" :
      st.state === "partial"  ? "bg-orange-400 border-orange-500" :
                                "bg-white border-gray-300";
    return (
      <button
        onClick={onClick}
        className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 ${cls}`}
      >
        <span className={`inline-block w-4 h-4 rounded border ${dot}`} />
        <span className="text-xs font-medium">{stage}</span>
      </button>
    );
  }

  function renderStagesCell(r: Record<string,string>) {
    const jobKey = getJobKey(r);
    return (
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {STAGE_COLUMNS.map(s => (
          <StageButton key={s} jobKey={jobKey} stage={s} onClick={() => openChecklist(r, s)} />
        ))}
      </div>
    );
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => Object.values(r).some(v => String(v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  /* ---------------- Render ---------------- */
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid gap-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Workshop Schedule — Tri-state checklists</h1>
            <p className="text-sm text-gray-600">
              Click any stage button to open its sub-tasks. Orange = in progress, Green = complete.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <input
              className="border rounded-lg px-3 py-2 w-[520px]"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
            <button onClick={loadSheet} disabled={loading} className="px-3 py-2 rounded-lg bg-black text-white">
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={async () => {
                for (const r of rows) {
                  const job = getJobKey(r);
                  if (!job) continue;
                  const remote = await pullJob(job);
                  if (remote?.items?.length) mergeRemoteIntoState(job, remote.items);
                }
              }}
              className="px-3 py-2 rounded-lg bg-blue-500 text-white"
            >
              Sync Now
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
            <table className="min-w-full text-sm table-auto">
              <thead className="bg-gray-100">
                <tr>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Job</th>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Client</th>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Link to Folder</th>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap" style={{ minWidth: 560 }}>Stages</th>
                  <th className="text-left px-3 py-3 border-b whitespace-nowrap">Progress</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const jobKey = getJobKey(r);
                  const link = getFolderUrl(r);
                  const overall = getRowOverallPct(jobKey);
                  const isOpen = openKey === jobKey && !!openStage;

                  return (
                    <React.Fragment key={i}>
                      <tr className="odd:bg-white even:bg-gray-50 border-b-2">
                        <td className="px-3 py-3 border-b whitespace-nowrap">{jobKey || "-"}</td>
                        <td className="px-3 py-3 border-b whitespace-nowrap">{r["Client"] || r["client"] || "-"}</td>
                        <td className="px-3 py-3 border-b whitespace-nowrap">
                          {link ? <a className="text-blue-600 underline" href={link} target="_blank" rel="noreferrer">Open</a> : "-"}
                        </td>
                        <td className="px-3 py-3 border-b">{renderStagesCell(r)}</td>
                        <td className="px-3 py-3 border-b min-w-[220px]">
                          <div className="w-48 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-3 bg-green-500" style={{ width: overall + "%" }} />
                          </div>
                          <div className="text-[11px] text-gray-600 mt-1">Overall {overall}%</div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={5} className="bg-gray-50">
                            <div className="p-3 grid gap-3">
                              <div className="text-sm font-medium">{jobKey} — {openStage}</div>
                              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                {(SECTION_DEFS[openStage] || []).map(name => {
                                  const st = getStageProgress(jobKey, openStage).subs[name];
                                  const status = st?.status || "none";
                                  return (
                                    <div key={name} className="bg-white border rounded-lg p-3 grid gap-2">
                                      <div className="flex items-center gap-2">
                                        <select
                                          className="border rounded px-2 py-1 text-sm"
                                          value={status}
                                          onChange={(e) => setSubStatus(r, openStage, name, e.target.value as any)}
                                        >
                                          <option value="none">Not started</option>
                                          <option value="progress">In progress</option>
                                          <option value="done">Done</option>
                                        </select>
                                        <span className="text-sm">{name}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => (SECTION_DEFS[openStage] || []).forEach(n => setSubStatus(r, openStage, n, "done"))}
                                  className="px-3 py-1 rounded-lg border text-xs"
                                >
                                  Mark All Done
                                </button>
                                <button
                                  onClick={() => (SECTION_DEFS[openStage] || []).forEach(n => setSubStatus(r, openStage, n, "none"))}
                                  className="px-3 py-1 rounded-lg border text-xs"
                                >
                                  Clear All
                                </button>
                                <button onClick={() => { setOpenKey(""); setOpenStage(""); }} className="ml-auto px-3 py-1 rounded-lg border text-xs">
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

        <footer className="text-xs text-gray-500 text-center">
          Sheet is the source of truth. Sub-task updates write to the <b>WorkshopJobState</b> tab and are pulled back every 15s.
        </footer>
      </div>
    </div>
  );
}
