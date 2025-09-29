// /api/state.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const STATE_API = process.env.STATE_API as string;

function setCORS(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!STATE_API) {
    return res.status(500).json({ ok: false, where: "proxy", error: "Missing STATE_API env var" });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(STATE_API);
      for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
      const resp = await fetch(url.toString(), { method: "GET" });
      const text = await resp.text();
      try {
        return res.status(resp.status).json(JSON.parse(text));
      } catch {
        return res.status(resp.status).json({ ok: false, where: "apps-script", status: resp.status, text });
      }
    }

    if (req.method === "POST") {
      const resp = await fetch(STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body || {}),
      });
      const text = await resp.text();
      try {
        return res.status(resp.status).json(JSON.parse(text));
      } catch {
        return res.status(resp.status).json({ ok: false, where: "apps-script", status: resp.status, text });
      }
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    return res.status(500).json({ ok: false, where: "proxy-catch", error: String(err?.message || err) });
  }
}
