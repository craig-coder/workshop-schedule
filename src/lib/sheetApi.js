// Use Vite env var (works in your setup)
const API = (import.meta && import.meta.env && import.meta.env.VITE_SHEET_API) || "";

function assertApi() {
  if (!API) throw new Error("Missing VITE_SHEET_API – set it in Vercel to your Apps Script Web App URL");
}

export async function getState() {
  assertApi();
  const res = await fetch(`${API}?route=state`);
  return res.json();
}

export async function setState(key, value, by = "VercelApp") {
  assertApi();
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: "state:set", key, value, by }),
  });
  return res.json();
}
