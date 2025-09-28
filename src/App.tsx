import React, { useState, useEffect } from "react";
import "./App.css";

const SYNC_URL =
  "https://script.google.com/macros/s/AKfycbyha1bpsQm0lBQU5tJE0L4vCEd8yJlJNFoZF5b5PqZMudb9RlF8Run7JYMFzw2OSWQGIQ/exec";

// All stages and their subtasks
const STAGES: Record<string, string[]> = {
  Draw: ["Cabinets Drawn", "Fronts Drawn"],
  Order: ["LDL", "Handles", "Decormax", "Hafele", "Consumables Check", "Misc"],
  CNC: ["Fronts", "Cabinets"],
  Edging: ["Fronts", "Cabinets"],
  Joinery: ["End Dominos", "Angles Cut", "Drawer Packs", "Other"],
  Prime: ["Prep", "Side 1", "Side 2"],
  "Top Coat": ["Prep 1", "Side 1.1", "Side 2.1", "Prep 2", "Side 2.1", "Side 2.2"],
  "Wrap & Pack": [
    "Fronts Packed",
    "Cabinets Packed",
    "Fitters Kit Packed",
    "Rails Cut",
    "Loaded",
  ],
  Remedials: [],
  "Job Complete": [],
};

// State type
type SubtaskState = "none" | "in-progress" | "done";

interface JobRow {
  Client: string;
  ["Link to Folder"]: string;
  ["Days Until Delivery"]: string | number;
  [stage: string]: any;
}

/***** Helpers *****/
function classForState(state: SubtaskState) {
  if (state === "done") return "cell-done";
  if (state === "in-progress") return "cell-progress";
  return "cell-none";
}

async function pushUpdate(
  job: string,
  stage: string,
  subtask: string,
  status: SubtaskState
) {
  const payload = { job, stage, subtask, status };
  console.log("[pushUpdate] sending", payload);
  const res = await fetch(SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  console.log("[pushUpdate] ok:", data);
  return data;
}

// NEW — snapshot writer for Tracker
async function pushStageSnapshot(jobKey: string, stage: string, state: SubtaskState) {
  try {
    await fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route: "stage:set", job: jobKey, stage, state }),
    });
  } catch (err) {
    console.warn("pushStageSnapshot failed", err);
  }
}

function getStageProgress(
  job: string,
  stage: string,
  states: Record<string, Record<string, SubtaskState>>
): { state: SubtaskState; percent: number } {
  const subs = STAGES[stage] || [];
  const jobStates = states[job] || {};
  if (subs.length === 0) return { state: "none", percent: 0 };

  let done = 0,
    started = 0;
  subs.forEach((s) => {
    const st = jobStates[`${stage}:${s}`];
    if (st === "done") done++;
    if (st && st !== "none") started++;
  });

  if (done === subs.length) return { state: "done", percent: 100 };
  if (started > 0) return { state: "in-progress", percent: (done / subs.length) * 100 };
  return { state: "none", percent: 0 };
}

/***** Main Component *****/
const App: React.FC = () => {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [states, setStates] = useState<Record<string, Record<string, SubtaskState>>>({});
  const [expanded, setExpanded] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const url =
      "https://docs.google.com/spreadsheets/d/1Meojz6Ob41qPc2m-cvws24d1Zf7TTfqmo4cD_AFUOXU/gviz/tq?tqx=out:csv&sheet=Tracker";
    const res = await fetch(url);
    const text = await res.text();

    const rows = text.split("\n").map((r) => r.split(","));
    const header = rows[0];
    const data: JobRow[] = rows.slice(1).map((r) => {
      const obj: any = {};
      header.forEach((h, i) => (obj[h.trim()] = r[i]));
      return obj;
    });

    setJobs(data.filter((d) => d.Client));
  }

  function toggleSub(job: string, stage: string) {
    setExpanded((prev) => ({
      ...prev,
      [job]: { ...prev[job], [stage]: !prev[job]?.[stage] },
    }));
  }

  function cycleState(job: string, stage: string, sub: string) {
    const key = `${stage}:${sub}`;
    const prev = states[job]?.[key] || "none";
    const next: SubtaskState =
      prev === "none" ? "in-progress" : prev === "in-progress" ? "done" : "none";

    const newStates = {
      ...states,
      [job]: { ...states[job], [key]: next },
    };
    setStates(newStates);

    pushUpdate(job, stage, sub, next);
    pushStageSnapshot(job, stage, getStageProgress(job, stage, newStates).state);
  }

  return (
    <div className="app">
      <h2>Workshop Schedule — Tri-state checklists</h2>
      <table className="jobs fullwidth">
        <thead>
          <tr>
            <th>Client</th>
            <th>Link to Folder</th>
            <th>Days Until Delivery</th>
            <th colSpan={Object.keys(STAGES).length}>Stages</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job, i) => (
            <tr key={i}>
              <td>{job.Client}</td>
              <td>
                {job["Link to Folder"] ? (
                  <a href={job["Link to Folder"]} target="_blank" rel="noreferrer">
                    Open
                  </a>
                ) : (
                  "-"
                )}
              </td>
              <td>{job["Days Until Delivery"]}</td>
              {Object.keys(STAGES).map((stage) => {
                const prog = getStageProgress(job.Client, stage, states);
                const isExpanded = expanded[job.Client]?.[stage];
                return (
                  <td key={stage}>
                    <button
                      className={classForState(prog.state)}
                      onClick={() => toggleSub(job.Client, stage)}
                    >
                      {stage}
                    </button>
                    {isExpanded && (
                      <div className="subs">
                        {STAGES[stage].map((s) => {
                          const st = states[job.Client]?.[`${stage}:${s}`] || "none";
                          return (
                            <div
                              key={s}
                              className={`sub ${classForState(st)}`}
                              onClick={() => cycleState(job.Client, stage, s)}
                            >
                              {s}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default App;
