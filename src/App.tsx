import React from "react";

// All app <-> sheet sync goes through the Vercel proxy
const SYNC_URL = "/api/sheets";

const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091";

/* ---------------- CSV utils ---------------- */
function toCsvUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (url.hostname.includes("docs.google.com") && url.pathname.includes("/spreadsheets/")) {
      const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = m ? m[1] : null;
      const gid = url.searchParams.get("gid") || "0";
      // Use export endpoint (more reliable & proper CORS headers)
      if (id) return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
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

/* ---------------- App config: stages/subtasks ---------------- */
const SECTION_DEFS: Record<string, string[]> = {
  Draw: ["Cabinets Drawn", "Fronts Drawn"],
  Order: ["LDL Order", "Decormax Order", "Tikkurila Order", "Fitters Kit Packed & Consumables Checked"],
  CNC: ["Fronts Machined", "Cabinets Machined"],
  Edging: ["Cabinets Edged", "Fronts Edged"],
  Joinery: ["Door Panels Glued", "Mitres Cut", "Edge Dominos", "Any Other Joinery Needed"],
  Prime: ["Prep", "Side 1", "Side 2"],
  "Top Coat": ["Prep", "Side 1.1", "Side 2.1", "Prep", "Side 1.2", "Side 2.2"],
  "Wrap & Pack": ["Cabinets Wrapped", "Rails Cut", "Doors Wrapped", "Fitters Kit Checked"],
  Install: ["Delivered", "Onsite Fit", "Snag List Completed"],
  Complete: ["Client Sign-off", "Photos Taken", "Invoice Sent"],
};
const STAGE_COLUMNS = ["Draw", "Order", "CNC", "Edging", "Joinery", "Prime", "Top Coat", "Wrap & Pack"] as const;

/* ---------------- Local progress store ---------------- */
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

/* ---------------- Job key helpers (IMPORTANT) ---------------- */
function cleanText(s?: string) {
  const v = String(s ?? "").trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  // Treat boolean-ish cells as empty
  if (["true", "false", "1", "0", "✓", "✗"].includes(lower)) return "";
  return v.replace(/\s+/g, " ");
}

/**
 * Match the sheet’s `WorkshopJobState!A` (job) exactly.
 * Your sheet currently stores just the client name as the job key,
 * unless a “Job” column exists in the CSV.
 */
function getJobKey(r: Record<string, string>) {
  // Prefer explicit Job column if present in your CSV
  const fromJobCol = cleanText(r["Job"] || r["job"]);
  if (fromJobCol) return fromJobCol;

  // Otherwise use Client/Customer (this matches your sheet now)
  const client = cleanText(r["Client"] || r["Customer"]);
  if (client) return client;

  // Fallbacks
  const id = cleanText(r["ID"] || r["Job No"] || r["Order No"]);
  if (id) return id;

  return JSON.stringify({ Client: client || r["Client"] || "" });
}

/* ---------------- Component ---------------- */
export default function App() {
  const [sheetUrl, setSheetUrl] = React.useState(DEFAULT_SHEET_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [progress, setProgress] = useLocalProgress();
  const [openKey, setOpenKey] = React.useState("");
  const [openStage, setOpenStage] = React.useState<string>("");
  const [syncing, setSyncing] = React.useState(false);

  const colMap = { title: "Job", status: "Status", start: "Start", end: "End", assignee: "Assigned To", id: "ID" };

  /* -------- load CSV -------- */
  async function fetchWithTimeout(url: string, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

async function loadSheet() {
  try {
    setError("");
    setLoading(true);

    const url = toCsvUrl(sheetUrl);
    console.log("[CSV] fetching:", url);

    const res = await fetchWithTimeout(url, 12000);
    if (!res.ok) throw new Error("CSV fetch failed: " + res.status);

    const text = await res.text();
    // quick sanity check so we don’t parse an HTML error page
    if (text.startsWith("<!DOCTYPE html") || text.toLowerCase().includes("<html")) {
      throw new Error("Got HTML instead of CSV (likely permissions). Make the sheet 'Anyone with link: Viewer'.");
    }

    const parsed = parseCsv(text);
    console.log("[CSV] parsed:", parsed.headers, parsed.rows.length, "rows");

    setHeaders(parsed.headers);
    setRows(parsed.rows);
  } catch (e: any) {
    console.error("[CSV] error:", e);
    setError(e?.message || "Failed to load sheet");
    setHeaders([]);
    setRows([]);
  } finally {
    setLoading(false);      // <- guarantees the spinner/sync state stops
  }
}

  React.useEffect(() => {
    loadSheet();
  }, []);

  /* -------- progress helpers -------- */
  function getStageProgress(jobKey: string, stage: string) {
    const s = progress[jobKey]?.[stage] ?? { subs: {} as Record<string, any> };
    const names = SECTION_DEFS[stage] || [];
    const map: Record<string, { status: "none" | "progress" | "done"; notes?: string }> = {};
    let done = 0,
      started = 0;
    for (const n of names) {
      const raw = s.subs?.[n];
      let status: "none" | "progress" | "done" = "none";
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
    const state: "none" | "partial" | "complete" = done === total && total > 0 ? "complete" : started > 0 ? "partial" : "none";
    return { subs: map, pct, state };
  }

  function getRowOverallPct(jobKey: string) {
    let total = 0,
      count = 0;
    for (const stage of STAGE_COLUMNS) {
      if ((SECTION_DEFS[stage] || []).length === 0) continue;
      total += getStageProgress(jobKey, stage).pct;
      count++;
    }
    return count > 0 ? Math.round(total / count) : 0;
  }

  /* -------- server sync helpers -------- */
  async function pullJob(jobKey: string) {
    try {
      console.log("pullJob ->", jobKey);
      const res = await fetch(`${SYNC_URL}?job=${encodeURIComponent(jobKey)}`, { method: "GET" });
      if (!res.ok) return null;
      const j = await res.json();
      if (Array.isArray(j?.items)) return { items: j.items };
      if (Array.isArray(j?.data)) return { items: j.data };
      return { items: [] };
    } catch {
      return null;
    }
  }

  function mergeRemoteIntoLocal(jobKey: string, items: any[]) {
    setProgress((prev: any) => {
      const nextJob = { ...(prev[jobKey] || {}) };
      items.forEach((it: any) => {
        const st = nextJob[it.stage] || { subs: {} };
        st.subs[it.subtask] = { status: it.status || "none", notes: it.notes || "" };
        nextJob[it.stage] = st;
      });
      return { ...prev, [jobKey]: nextJob };
    });
  }

  async function pushUpdate(payload: any) {
    try {
      await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      /* keep UI responsive on errors */
    }
  }

  /* -------- UI actions for subtask changes -------- */
  function setSubStatus(r: Record<string, string>, stage: string, name: string, status: "none" | "progress" | "done") {
    const job = getJobKey(r);
    setProgress((prev: any) => {
      const cur = prev[job]?.[stage] ?? { subs: {} };
      const curItem = cur.subs?.[name] || { status: "none" };
      const next = { subs: { ...(cur.subs || {}), [name]: { status, notes: curItem.notes } } };
      return { ...prev, [job]: { ...(prev[job] || {}), [stage]: next } };
    });
    pushUpdate({ job, updatedBy: r["Assigned To"] || "Unknown", stage, subtask: name, status });
  }

  function setSubNotes(r: Record<string, string>, stage: string, name: string, notes: string) {
    const job = getJobKey(r);
    setProgress((prev: any) => {
      const cur = prev[job]?.[stage] ?? { subs: {} };
      const curItem = cur.subs?.[name] || { status: "progress" };
      const next = { subs: { ...(cur.subs || {}), [name]: { status: curItem.status || "progress", notes } } };
      return { ...prev, [job]: { ...(prev[job] || {}), [stage]: next } };
    });
    pushUpdate({ job, updatedBy: r["Assigned To"] || "Unknown", stage, subtask: name, status: "progress", notes });
  }

  /* -------- open checklist + initial fetch -------- */
  async function openChecklist(r: Record<string, string>, stage: string) {
    if (!SECTION_DEFS[stage]) {
      alert("No subtasks configured for " + stage);
      return;
    }
    const jobKey = getJobKey(r);
    setOpenKey(jobKey);
    setOpenStage(stage);
    const remote = await pullJob(jobKey);
    if (remote && Array.isArray(remote.items)) {
      mergeRemoteIntoLocal(jobKey, remote.items);
    }
  }

  /* -------- Sync now button -------- */
  async function syncNow() {
    try {
      setSyncing(true);
      console.log("Sync now clicked");
      for (const r of rows) {
        const jobKey = getJobKey(r);
        const remote = await pullJob(jobKey);
        const count = remote?.items?.length || 0;
        console.log(`  → fetched ${jobKey} — ${count} item(s)`);
        if (count) mergeRemoteIntoLocal(jobKey, remote!.items);
      }
    } finally {
      setSyncing(false);
    }
  }

  /* -------- Poll the open checklist every 10s -------- */
  React.useEffect(() => {
    if (!openKey) return;
    let cancelled = false;
    async function refresh() {
      const remote = await pullJob(openKey);
      if (!cancelled && remote && Array.isArray(remote.items)) {
        mergeRemoteIntoLocal(openKey, remote.items);
      }
    }
    refresh();
    const id = window.setInterval(refresh, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [openKey]);

  /* -------- Global background refresh every 15s -------- */
  React.useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    async function refreshAll() {
      console.log("Global sync tick — refreshing all jobs");
      for (const r of rows) {
        const jobKey = getJobKey(r);
        const remote = await pullJob(jobKey);
        const count = remote?.items?.length || 0;
        console.log(`  → fetched ${jobKey} — ${count} item(s)${count ? "" : " (skip clear)"}`);
        if (!cancelled && count) {
          mergeRemoteIntoLocal(jobKey, remote!.items);
        }
      }
    }
    const id = window.setInterval(refreshAll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [rows]);

  /* -------- small UI bits -------- */
  function BoolCell({ on }: { on: boolean }) {
    return (
      <span
        className={
          on
            ? "inline-block w-4 h-4 rounded border bg-green-500 border-green-600"
            : "inline-block w-4 h-4 rounded border bg-white border-gray-300"
        }
      />
    );
  }

  function renderCell(h: string, r: Record<string, string>) {
    if ((STAGE_COLUMNS as readonly string[]).includes(h)) {
      const key = getJobKey(r);
      const st = getStageProgress(key, h);
      const cls =
        st.state === "complete"
          ? "bg-green-50 border-green-600"
          : st.state === "partial"
          ? "bg-orange-50 border-orange-500"
          : "bg-white border-gray-300";
      const box =
        st.state === "complete"
          ? "bg-green-500 border-green-600"
          : st.state === "partial"
          ? "bg-orange-400 border-orange-500"
          : "bg-white border-gray-300";
      return (
        <button onClick={() => openChecklist(r, h)} className={`px-2 py-1 rounded-lg border flex items-center gap-2 ${cls}`}>
          <span className={`inline-block w-4 h-4 rounded border ${box}`} />
          <span className="text-xs font-medium">{h}</span>
        </button>
      );
    }
    const v = r[h];
    if (v === undefined || v === null) return null;
    const s = String(v).trim().toLowerCase();
    if (["true", "yes", "1", "✓"].includes(s)) return <BoolCell on={true} />;
    if (["false", "no", "0", "✗"].includes(s)) return <BoolCell on={false} />;
    return v;
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v || "").toLowerCase().includes(q)));
  }, [rows, query]);

  /* -------- render -------- */
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid gap-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Workshop Schedule — Tri-state checklists</h1>
            <p className="text-sm text-gray-600">
              Click any stage cell (Draw, Order, CNC, Edging, Joinery, Prime, Top Coat, Wrap &amp; Pack) to open sub-tasks. Orange =
              in progress, Green = complete.
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
              onClick={syncNow}
              disabled={syncing}
              className="px-3 py-2 rounded-lg border bg-white text-black disabled:opacity-60"
              title="Pull latest state from Google Sheet"
            >
              {syncing ? "Syncing…" : "Sync now"}
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
                  {headers.map((h) => (
                    <th key={h} className="text-left px-3 py-3 border-b whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                  <th className="text-left px-3 py-3 border-b">Progress</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const key = getJobKey(r);
                  const overall = getRowOverallPct(key);
                  const isOpen = openKey === key && !!openStage;
                  return (
                    <React.Fragment key={i}>
                      <tr className="odd:bg-white even:bg-gray-50 border-b-2">
                        {headers.map((h) => (
                          <td key={h} className="px-3 py-3 border-b whitespace-nowrap">
                            {renderCell(h, r)}
                          </td>
                        ))}
                        <td className="px-3 py-3 border-b min-w-[220px]">
                          <div className="w-48 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-3 bg-green-500" style={{ width: overall + "%" }} />
                          </div>
                          <div className="text-[11px] text-gray-600 mt-1">Overall {overall}%</div>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={headers.length + 1} className="bg-gray-50">
                            <div className="p-3 grid gap-3">
                              <div className="text-sm font-medium">{r[colMap.title] || "Job"} — {openStage}</div>
                              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                                {(SECTION_DEFS[openStage] || []).map((name) => {
                                  const sub = getStageProgress(key, openStage).subs[name];
                                  const status = sub?.status || "none";
                                  const notes = sub?.notes || "";
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
                                      {status === "progress" && (
                                        <input
                                          className="border rounded px-2 py-1 text-sm w-full"
                                          placeholder="Notes…"
                                          value={notes}
                                          onChange={(e) => setSubNotes(r, openStage, name, e.target.value)}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() =>
                                    (SECTION_DEFS[openStage] || []).forEach((n) => setSubStatus(r, openStage, n, "done"))
                                  }
                                  className="px-3 py-1 rounded-lg border text-xs"
                                >
                                  Mark All Done
                                </button>
                                <button
                                  onClick={() =>
                                    (SECTION_DEFS[openStage] || []).forEach((n) => setSubStatus(r, openStage, n, "none"))
                                  }
                                  className="px-3 py-1 rounded-lg border text-xs"
                                >
                                  Clear All
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenKey("");
                                    setOpenStage("");
                                  }}
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

        <footer className="text-xs text-gray-500 text-center">
          Weights, mandatory stages, and Google Apps Script persistence can be added next.
        </footer>
      </div>
    </div>
  );
}
