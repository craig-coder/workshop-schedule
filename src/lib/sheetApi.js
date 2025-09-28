// Hardcode your Apps Script Web App URL here (keep the quotes)
const HARDCODED_API = "https://script.google.com/macros/s/AKfycbxeXiLyEF3BCRZaxYkpwsaR5p6_tKS7fje83c8ZQ2GLbgRpXYcJdW22hVNIUvZKKkMS/exec";

// Use either hardcoded URL or environment variables (Vite)
const API =
  HARDCODED_API ||
  (import.meta?.env?.VITE_SHEET_API) ||
  (import.meta?.env?.VITE_SYNC_URL) ||
  "";

function assertApi() {
  if (!API) {
    throw new Error("Missing API – set HARDCODED_API or VITE_SHEET_API (or VITE_SYNC_URL) in Vercel");
  }
}

export async function getState() {
  assertApi();
  const res = await fetch(`${API}?route=state`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function setState(key, value, by = "VercelApp") {
  assertApi();
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: "state:set", key, value, by }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
