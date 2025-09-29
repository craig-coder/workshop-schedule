// /api/state.js  (root of repo)
// Vercel serverless function – JS version (no TypeScript build hassles)

const STATE_API = process.env.STATE_API;

/** CORS (harmless even for same-origin) */
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCORS(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!STATE_API) {
    return res.status(500).json({ ok: false, error: "Missing STATE_API env var" });
  }

  // ---------- GET ----------
  if (req.method === "GET") {
    const mode = String(req.query.mode || "state");

    if (mode === "health" || mode === "heartbeat") {
      return res.status(200).json({ ok: true, proxy: true, msg: "proxy alive" });
    }

    if (mode === "state") {
      const sheet = req.query.sheet;
      if (!sheet) return res.status(400).json({ ok: false, error: "Missing sheet" });

      try {
        const url = new URL(STATE_API);
        url.searchParams.set("mode", "state");
        url.searchParams.set("sheet", String(sheet));

        const upstream = await fetch(url.toString(), { method: "GET" });
        const data = await upstream.json().catch(() => null);
        return res.status(upstream.ok ? 200 : 502).json(
          data ?? { ok: false, error: "Upstream returned non-JSON" }
        );
      } catch (e) {
        return res.status(502).json({ ok: false, error: String(e) });
      }
    }

    return res.status(400).json({ ok: false, error: "Unknown GET" });
  }

  // ---------- POST ----------
  if (req.method === "POST") {
    try {
      const body =
        typeof req.body === "string" && req.body.length ? JSON.parse(req.body) : (req.body || {});

      const upstream = await fetch(STATE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await upstream.json().catch(() => null);
      return res.status(upstream.ok ? 200 : 502).json(
        data ?? { ok: false, error: "Upstream returned non-JSON" }
      );
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e) });
    }
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
