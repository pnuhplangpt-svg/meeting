const GET_ACTION_ALLOWLIST = new Set([
  'getReservations',
  'getReservationById',
  'getRooms',
  'verifyAdmin',
  'getSecurityAlerts',
  'getOperationalChecks',
  'getOperationalMetrics',
  'getOperationalMetricsReport',
  'getOperationalMetricsTrend'
]);

const POST_ACTION_ALLOWLIST = new Set([
  'createReservation',
  'updateReservation',
  'deleteReservation',
  'verifyPassword',
  'addRoom',
  'updateRoom',
  'deleteRoom',
  'sendOperationalMetricsReport'
]);

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

function getRateLimitStore() {
  if (!globalThis.__MEETING_PROXY_RL__) {
    globalThis.__MEETING_PROXY_RL__ = new Map();
  }
  return globalThis.__MEETING_PROXY_RL__;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function checkRateLimit(req) {
  const store = getRateLimitStore();
  const now = Date.now();
  const ip = getClientIp(req);
  const key = ip + '|' + req.method;
  const item = store.get(key);

  if (!item || now - item.startedAt >= RATE_LIMIT_WINDOW_MS) {
    store.set(key, { count: 1, startedAt: now });
    return { allowed: true };
  }

  item.count += 1;
  store.set(key, item);
  if (item.count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSec: Math.ceil((RATE_LIMIT_WINDOW_MS - (now - item.startedAt)) / 1000) };
  }
  return { allowed: true };
}

function buildUpstreamPostBody(body) {
  if (typeof body === 'string') {
    return body;
  }
  if (body == null) {
    return '{}';
  }
  return JSON.stringify(body);
}

function parseIncomingPostBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (e) {
      return null;
    }
  }
  if (body && typeof body === 'object') {
    return body;
  }
  return null;
}

function ensureGetActionPolicy(action, query) {
  if (!GET_ACTION_ALLOWLIST.has(action)) {
    return { ok: false, status: 400, error: '허용되지 않은 GET 액션입니다.' };
  }

  if (action === 'getReservations') {
    const date = query && query.date ? String(query.date).trim() : '';
    const floor = query && query.floor ? String(query.floor).trim() : '';
    if (!date || !floor) {
      return { ok: false, status: 400, error: 'getReservations 요청에는 date와 floor가 필요합니다.' };
    }
  }

  return { ok: true };
}

function ensurePostActionPolicy(action) {
  if (!POST_ACTION_ALLOWLIST.has(action)) {
    return { ok: false, status: 400, error: '허용되지 않은 POST 액션입니다.' };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  const upstream = process.env.APPS_SCRIPT_URL;

  if (!upstream) {
    return res.status(500).json({ success: false, error: 'Server misconfiguration: APPS_SCRIPT_URL is not set.' });
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  const limit = checkRateLimit(req);
  if (!limit.allowed) {
    if (limit.retryAfterSec) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
    }
    return res.status(429).json({ success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  const target = new URL(upstream);
  let requestBody = req.body;

  if (req.method === 'GET') {
    const action = req.query && req.query.action ? String(req.query.action).trim() : '';
    const policy = ensureGetActionPolicy(action, req.query || {});
    if (!policy.ok) {
      return res.status(policy.status).json({ success: false, error: policy.error });
    }

    Object.keys(req.query || {}).forEach(function(key) {
      const value = req.query[key];
      if (Array.isArray(value)) {
        value.forEach(function(item) {
          target.searchParams.append(key, String(item));
        });
        return;
      }
      if (value != null) {
        target.searchParams.set(key, String(value));
      }
    });
  }

  if (req.method === 'POST') {
    const parsed = parseIncomingPostBody(req.body);
    if (!parsed || typeof parsed.action !== 'string' || !parsed.action.trim()) {
      return res.status(400).json({ success: false, error: 'POST 요청 본문에 action이 필요합니다.' });
    }

    const policy = ensurePostActionPolicy(parsed.action.trim());
    if (!policy.ok) {
      return res.status(policy.status).json({ success: false, error: policy.error });
    }
    requestBody = parsed;
  }

  try {
    const upstreamResponse = await fetch(target.toString(), {
      method: req.method,
      headers: req.method === 'POST' ? { 'Content-Type': 'text/plain; charset=utf-8' } : undefined,
      body: req.method === 'POST' ? buildUpstreamPostBody(requestBody) : undefined
    });

    const rawBody = await upstreamResponse.text();
    res.status(upstreamResponse.status);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(rawBody);
  } catch (error) {
    return res.status(502).json({ success: false, error: 'Upstream request failed.' });
  }
}
