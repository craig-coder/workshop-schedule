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

const STAGE_CO_
