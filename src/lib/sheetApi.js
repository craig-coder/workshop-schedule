
const API =
  (import.meta?.env?.VITE_SHEET_API) ||
  (import.meta?.env?.VITE_SYNC_URL) ||
  "";

function assertApi() {
  if (!API) {
    throw new Error(
      "Missing VITE_SHEET_API (or VITE_SYNC_URL) – set it in Vercel to your Apps Script Web App URL"
    );
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
