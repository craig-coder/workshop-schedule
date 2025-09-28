import React from "react";

const STATE_URL =
  "https://script.google.com/macros/s/AKfycbyha1bpsQm0lBQU5tJE0L4vCEd8yJlJNFoZF5b5PqZMudb9RlF8Run7JYMFzw2OSWQGIQ/exec";

const DEFAULT_TRACKER_URL =
  "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/edit?gid=270301091#gid=270301091";

function toCsvUrl(input: string) {
  try {
    const url = new URL(input.trim());
    if (
      url.hostname.includes("docs.google.com") &&
      url.pathname.includes("/spreadsheets/")
    ) {
      const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const id = m ? m[1] : null;
      const gid = url.searchParams.get("gid") || "0";
      if (id)
        return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;
    }
  } catch (_) {}
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

// Stages
const SECTION_DEFS: Record<string, string[]> = {
  Draw: ["Cabinets Drawn", "Fronts Drawn"],
  Order: ["LDL Order", "Decormax Order", "Tikkurila Order", "Fitters Kit Packed & Consumables Checked"],
  CNC: ["Fronts Machined", "Cabinets Machined"],
  Edging: ["Cabinets Edged", "Fronts Edged"],
  Joinery: ["Door Panels Glued", "Mitres Cut", "Edge Dominos", "Any Other Joinery Needed"],
  Prime: ["Prep", "Side 1", "Side 2"],
  "Top Coat": ["Prep", "Side 1.1", "Side 2.1", "Prep", "Side 1.2", "Side 2.2"],
  "Wrap & Pack": ["Cabinets Wrapped", "Rails Cut", "Doors Wrapped", "Fitters Kit Checked"],
  Remedials: ["Remedial Work Logged", "Remedial Completed"],
  Install: ["Delivered", "Onsite Fit", "Snag List Completed"],
  Complete: ["Client Sign-off", "Photos Taken", "Invoice Sent"],
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
  "Remedials",
] as const;

export default function App() {
  const [trackerUrl, setTrackerUrl] = React.useState(DEFAULT_TRACKER_URL);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [stateRows, setStateRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");

  async function loadTracker() {
    try {
      setLoading(true);
      const url = toCsvUrl(trackerUrl);
      const res = await fetch(url);
      if (!res.ok) throw new Error("Tracker fetch failed");
      const text = await res.text();
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
    } catch (e: any) {
      setError(e.message || "Failed to load tracker");
    } finally {
      setLoading(false);
    }
  }

  async function loadStates() {
    try {
      const res = await fetch(STATE_URL + "?route=all", { method: "GET" });
      if (!res.ok) throw new Error("State fetch failed");
      const j = await res.json();
      if (Array.isArray(j?.items)) {
        setStateRows(j.items);
      }
    } catch (e: any) {
      console.error("loadStates error", e);
    }
  }

  React.useEffect(() => {
    loadTracker();
    loadStates();
  }, []);

  React.useEffect(() => {
    const id = setInterval(() => {
      loadStates();
    }, 15000);
    return () => clearInterval(id);
  }, []);

  function getJobKey(r: Record<string, string>) {
    return (r["Client"] || r["Job"] || "").trim();
  }

  function getStageStatus(jobKey: string, stage: string) {
    const matches = stateRows.filter(
      (r) =>
        String(r.job || "").trim().toLowerCase() === jobKey.toLowerCase() &&
        String(r.stage || "").trim().toLowerCase() === stage.toLowerCase()
    );
    if (matches.length === 0) return { state: "none", notes: "" };
    const latest = matches[matches.length - 1];
    return { state: latest.status || "none", notes: latest.notes || "" };
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [rows, query]);

  function renderCell(h: string, r: Record<string, string>) {
    if ((STAGE_COLUMNS as readonly string[]).includes(h)) {
      const jobKey = getJobKey(r);
      const { state, notes } = getStageStatus(jobKey, h);
      const cls =
        state === "done"
          ? "bg-green-50 border-green-600"
          : state === "progress"
          ? "bg-orange-50 border-orange-500"
          : "bg-white border-gray-300";
      const box =
        state === "done"
          ? "bg-green-500 border-green-600"
          : state === "progress"
          ? "bg-orange-400 border-orange-500"
          : "bg-white border-gray-300";
      return (
        <div className={`px-2 py-1 rounded-lg border flex items-center gap-2 ${cls}`}>
          <span className={`inline-block w-4 h-4 rounded border ${box}`} />
          <span className="text-xs font-medium">{h}</span>
          {notes && <span className="text-[10px] text-gray-500">({notes})</span>}
        </div>
      );
    }
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
    if (h === "Delivery Date" || h === "Order Date") {
      return null;
    }
    return r[h];
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto grid gap-6">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Workshop Schedule — Tri-state checklists</h1>
            <p className="text-sm text-gray-600">
              Tracker sheet drives the job list. State sheet drives cell states. Orange = in progress, Green = complete.
            </p>
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
            <button onClick={loadStates} className="px-3 py-2 rounded-lg bg-blue-500 text-white">
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
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  {headers
                    .filter((h) => h !== "Delivery Date" && h !== "Order Date")
                    .map((h) => (
                      <th key={h} className="text-left px-3 py-3 border-b whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50 border-b-2">
                    {headers
                      .filter((h) => h !== "Delivery Date" && h !== "Order Date")
                      .map((h) => (
                        <td key={h} className="px-3 py-3 border-b whitespace-nowrap">
                          {renderCell(h, r)}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
