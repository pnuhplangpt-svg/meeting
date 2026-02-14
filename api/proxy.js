export default async function handler(req, res) {
  const upstream = process.env.APPS_SCRIPT_URL;

  if (!upstream) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfiguration: APPS_SCRIPT_URL is not set.'
    });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed.'
    });
  }

  try {
    const target = new URL(upstream);

    if (req.method === 'GET') {
      Object.keys(req.query || {}).forEach(function (key) {
        const value = req.query[key];
        if (Array.isArray(value)) {
          value.forEach(function (item) {
            target.searchParams.append(key, String(item));
          });
          return;
        }
        if (value != null) {
          target.searchParams.set(key, String(value));
        }
      });
    }

    const upstreamResponse = await fetch(target.toString(), {
      method: req.method,
      headers: req.method === 'POST'
        ? { 'Content-Type': 'text/plain' }
        : undefined,
      body: req.method === 'POST'
        ? JSON.stringify(req.body || {})
        : undefined
    });

    const rawBody = await upstreamResponse.text();
    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(rawBody);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: 'Upstream request failed.'
    });
  }
}
