// /api/state.ts (Vercel/Next API route, Node runtime)

// IMPORTANT: Vercel env var: STATE_API = <your Apps Script /exec URL>

import type { VercelRequest, VercelResponse } from "@vercel/node";

const STATE_API = process.env.STATE_API ?? ""; // Apps Script exec URL

function setCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const mode = String(req.query.mode ?? "").toLowerCase();

    // Health check
    if (mode === "health" || mode === "heartbeat") {
      return res.status(200).json({ ok: true, proxy: true, msg: "proxy alive" });
    }

    // Ensure STATE_API exists
    if (!STATE_API) {
      return res.status(500).json({ ok: false, where: "proxy", error: "Missing STATE_API env var" });
    }

    // ---- GET: read state from Apps Script ----
    if (req.method === "GET" && mode === "state") {
      // Accept encoded or plain sheet URLs
      let sheetParam = String(req.query.sheet ?? "");
      try {
        // If it's URL-encoded, decode once. If not, this will be a no-op.
        sheetParam = decodeURIComponent(sheetParam);
      } catch {
        /* ignore decode errors */
      }
      if (!sheetParam) {
        return res.status(400).json({ ok: false, error: "Missing sheet" });
      }

      // Forward to Apps Script
      const url = new URL(STATE_API);
      url.searchParams.set("mode", "state");
      url.searchParams.set("sheet", sheetParam);

      const forward = await fetch(url.toString(), { method: "GET" });
      const text = await forward.text();

      // Try parse JSON; if failed, return raw text for easier debugging
      try {
        const json = JSON.parse(text);
        return res.status(forward.ok ? 200 : 500).json(json);
      } catch {
        return res.status(forward.ok ? 200 : 500).json({ ok: false, error: "Non-JSON from Apps Script", raw: text });
      }
    }

    // ---- POST: write to Apps Script ----
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const forward = await fetch(STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await forward.text();
      try {
        const json = JSON.parse(text);
        return res.status(forward.ok ? 200 : 500).json(json);
      } catch {
        return res.status(forward.ok ? 200 : 500).json({ ok: false, error: "Non-JSON from Apps Script", raw: text });
      }
    }

    // Unknown route
    return res.status(400).json({ ok: false, error: "Unknown GET/POST or mode" });
  } catch (err: any) {
    return res.status(500).json({ ok: false, where: "proxy", error: err?.message || String(err) });
  }
}
