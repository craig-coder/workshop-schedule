// /api/state.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

// This will be your Apps Script Web App URL (we'll set it in Vercel later)
const STATE_API = process.env.STATE_API as string;

// Add CORS headers so the browser can call this without errors
function setCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.status(200).end(); // preflight check
    return;
  }

  if (!STATE_API) {
    res.status(500).json({ ok: false, error: "Missing STATE_API env var" });
    return;
  }

  try {
    if (req.method === "GET") {
      // Forward GET requests
      const url = new URL(STATE_API);
      for (const [k, v] of Object.entries(req.query)) {
        url.searchParams.set(k, String(v));
      }
      const resp = await fetch(url.toString(), { method: "GET" });
      const text = await resp.text();
      try {
        res.status(resp.status).json(JSON.parse(text));
      } catch {
        res.status(resp.status).send(text);
      }
      return;
    }

    if (req.method === "POST") {
      // Forward POST requests
      const resp = await fetch(STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
      });
      const text = await resp.text();
      try {
        res.status(resp.status).json(JSON.parse(text));
      } catch {
        res.status(resp.status).send(text);
      }
      return;
    }

    res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}
