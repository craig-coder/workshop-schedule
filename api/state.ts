// /api/state.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const STATE_API = process.env.STATE_API as string;

// Add CORS headers
function setCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (!STATE_API) {
    res.status(500).json({ ok: false, error: "Missing STATE_API env var" });
    return;
  }

  try {
    const mode = (req.query.mode as string) || "";
    if (mode === "health") {
      res.status(200).json({ ok: true, proxy: true, msg: "Proxy alive" });
      return;
    }

    if (req.method === "GET" && mode === "state") {
      // Forward GET to Apps Script
      const sheet = req.query.sheet as string;
      const url = new URL(STATE_API);
      url.searchParams.set("mode", "state");
      if (sheet) url.searchParams.set("sheet", sheet);

      const resp = await fetch(url.toString(), { method: "GET" });
      const json = await resp.json();
      res.status(200).json(json);
      return;
    }

    if (req.method === "POST") {
      // Forward POST to Apps Script
      const resp = await fetch(STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
      const json = await resp.json();
      res.status(200).json(json);
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown request" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message || "Proxy error" });
  }
}
