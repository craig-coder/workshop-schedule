
const API = "/api/sheets";

export async function getState() {
  const res = await fetch(`${API}?route=state`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

export async function setState(key, value, by = "VercelApp") {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route: "state:set", key, value, by }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}
