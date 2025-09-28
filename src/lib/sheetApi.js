const API = process.env.NEXT_PUBLIC_SHEET_API;

// Get data from Google Sheet
export async function getState() {
  const res = await fetch(`${API}?route=state`);
  return res.json();
}

// Save data to Google Sheet
export async function setState(key, value, by = "VercelApp") {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route: "state:set",
      key,
      value,
      by,
    }),
  });
  return res.json();
}
