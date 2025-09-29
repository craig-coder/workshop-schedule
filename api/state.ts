// /api/state.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const STATE_API = process.env.STATE_API as string | undefined;

function sendJSON(res: VercelResponse, body: any, status = 200) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}

function setCORS(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Health check (works even without STATE_API set)
  if (req.method === 'GET' && (req.query.mode === 'health' || req.query.mode === 'heartbeat')) {
    return sendJSON(res, { ok: true, proxy: true, msg: 'proxy alive' });
  }

  if (!STATE_API) {
    return sendJSON(res, { ok: false, where: 'proxy', error: 'Missing STATE_API env var' }, 500);
  }

  // ---- GET -> read state ----
  if (req.method === 'GET' && req.query.mode === 'state') {
    const sheet = String(req.query.sheet || '').trim();
    if (!sheet) return sendJSON(res, { ok: false, error: 'Missing sheet' }, 400);

    try {
      const url = `${STATE_API}?mode=state&sheet=${encodeURIComponent(sheet)}`;
      const r = await fetch(url, { method: 'GET' });
      const json = await r.json().catch(() => ({}));
      return sendJSON(res, json, r.ok ? 200 : 500);
    } catch (err: any) {
      return sendJSON(res, { ok: false, error: String(err?.message || err) }, 500);
    }
  }

  // ---- POST -> write state ----
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (!body?.sheet) return sendJSON(res, { ok: false, error: 'Missing sheet' }, 400);

      const r = await fetch(STATE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await r.json().catch(() => ({}));
      return sendJSON(res, json, r.ok ? 200 : 500);
    } catch (err: any) {
      return sendJSON(res, { ok: false, error: String(err?.message || err) }, 500);
    }
  }

  return sendJSON(res, { ok: false, error: 'Unknown GET' }, 404);
}
