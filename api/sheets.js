// Serverless proxy to Google Apps Script to avoid CORS issues.
export default async function handler(req, res) {
  // Use your working Apps Script URL:
const API = "https://script.google.com/macros/s/AKfycbyha1bpsQm0lBQU5tJE0L4vCEd8yJlJNFoZF5b5PqZMudb9RlF8Run7JYMFzw2OSWQGIQ/exec";


  try {
    let url = API;

    if (req.method === "GET") {
      // pass through ?route and ?job if present; default route=state
      const route = (req.query.route || "state");
      const job   = req.query.job;
      const params = new URLSearchParams({ route });
      if (job) params.set("job", job);
      url = `${API}?${params.toString()}`;

      const r = await fetch(url);
      const text = await r.text();
      // Try to return JSON; if not, pass text to help debugging
      try {
        const json = JSON.parse(text);
        res.status(r.status).json(json);
      } catch {
        res.status(502).json({ ok:false, error:"Upstream not JSON", upstream:text.slice(0,400) });
      }
      return;
    }

    // POST: forward JSON body as-is
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      res.status(r.status).json(json);
    } catch {
      res.status(502).json({ ok:false, error:"Upstream not JSON", upstream:text.slice(0,400) });
    }
  } catch (err) {
    res.status(500).json({ ok:false, error: String(err) });
  }
}
