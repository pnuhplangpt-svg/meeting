import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

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

const GET_ACTION_REQUIRED_PARAMS = {
  getReservationById: ['id'],
  verifyAdmin: ['code'],
  getSecurityAlerts: ['adminToken'],
  getOperationalChecks: ['adminToken'],
  getOperationalMetrics: ['adminToken'],
  getOperationalMetricsReport: ['adminToken'],
  getOperationalMetricsTrend: ['adminToken']
};

const POST_ACTION_REQUIRED_FIELDS = {
  createReservation: ['date', 'floor', 'startTime', 'endTime', 'teamName', 'userName', 'password'],
  updateReservation: ['id', 'token'],
  deleteReservation: ['id'],
  verifyPassword: ['id', 'password'],
  addRoom: ['adminToken', 'floor', 'name'],
  updateRoom: ['adminToken', 'roomId'],
  deleteRoom: ['adminToken', 'roomId'],
  sendOperationalMetricsReport: ['adminToken']
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const RESERVATION_TOKEN_TTL_SEC = 10 * 60;
const ADMIN_TOKEN_TTL_SEC = 12 * 60 * 60;

function isSupabaseReadEnabled() {
  return String(process.env.SUPABASE_READ_ENABLED || '').toLowerCase() === 'true';
}

function isSupabaseWriteEnabled() {
  return String(process.env.SUPABASE_WRITE_ENABLED || '').toLowerCase() === 'true';
}

function isStrictPasswordHashEnabled() {
  return String(process.env.SUPABASE_STRICT_PASSWORD_HASH || '').toLowerCase() === 'true';
}

function getProxyAdminCode() {
  return String(process.env.PROXY_ADMIN_CODE || '').trim();
}

function isProxyAdminEnabled() {
  return !!getProxyAdminCode();
}

function getSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || '')
  };
}

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
  if (typeof body === 'string') return body;
  if (body == null) return '{}';
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
  if (body && typeof body === 'object') return body;
  return null;
}

function isNonEmptyValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function ensureRequiredValues(container, requiredFields) {
  for (let i = 0; i < requiredFields.length; i++) {
    const key = requiredFields[i];
    if (!isNonEmptyValue(container[key])) return key;
  }
  return '';
}

function ensureGetActionPolicy(action, query) {
  if (!GET_ACTION_ALLOWLIST.has(action)) {
    return { ok: false, status: 400, error: '허용되지 않은 GET 액션입니다.' };
  }

  const required = GET_ACTION_REQUIRED_PARAMS[action] || [];
  const missingKey = ensureRequiredValues(query || {}, required);
  if (missingKey) {
    return { ok: false, status: 400, error: 'GET 요청 파라미터가 누락되었습니다: ' + missingKey };
  }

  return { ok: true };
}

function ensurePostActionPolicy(action, body) {
  if (!POST_ACTION_ALLOWLIST.has(action)) {
    return { ok: false, status: 400, error: '허용되지 않은 POST 액션입니다.' };
  }

  const required = POST_ACTION_REQUIRED_FIELDS[action] || [];
  const missingKey = ensureRequiredValues(body || {}, required);
  if (missingKey) {
    return { ok: false, status: 400, error: 'POST 요청 필드가 누락되었습니다: ' + missingKey };
  }

  return { ok: true };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeFloor(value) {
  return String(value || '').trim().toUpperCase();
}

function sanitizeText(value, maxLength) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return '';
  return v.substring(0, maxLength);
}

function isValidDateString(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function isValidTimeString(v) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function isValidTimeRange(startTime, endTime) {
  return isValidTimeString(startTime) && isValidTimeString(endTime) && startTime < endTime;
}

function mapRoomRecord(row) {
  return {
    '회의실ID': String(row.id || ''),
    '층': String(row.floor || ''),
    '이름': String(row.name || ''),
    '활성화': !!row.is_active
  };
}

function mapReservationRecord(row) {
  const createdAt = row.created_at ? new Date(row.created_at).toISOString() : '';
  const date = row.date ? String(row.date) : '';
  const start = row.start_time ? String(row.start_time).slice(0, 5) : '';
  const end = row.end_time ? String(row.end_time).slice(0, 5) : '';
  return {
    '예약ID': String(row.id || ''),
    '날짜': date,
    '층': String(row.floor || ''),
    '시작시간': start,
    '종료시간': end,
    '팀명': String(row.team_name || ''),
    '예약자': String(row.user_name || ''),
    '생성일시': createdAt
  };
}

async function supabaseRequest(config, method, table, queryParams, body) {
  const url = new URL(config.url + '/rest/v1/' + table);
  Object.keys(queryParams || {}).forEach(function(key) {
    if (queryParams[key] != null && queryParams[key] !== '') {
      url.searchParams.set(key, String(queryParams[key]));
    }
  });

  const headers = {
    apikey: config.serviceRoleKey,
    Authorization: 'Bearer ' + config.serviceRoleKey,
    Accept: 'application/json'
  };

  let reqBody;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: reqBody
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error('Supabase request failed: ' + table + ' (' + res.status + ') ' + text);
  }

  const raw = await res.text();
  if (!raw) return null;

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  return raw;
}

async function supabaseSelect(config, table, queryParams) {
  return supabaseRequest(config, 'GET', table, queryParams);
}

function shouldServeGetFromSupabase(action, query) {
  if (action === 'verifyAdmin' && isProxyAdminEnabled()) return true;
  if (!isSupabaseReadEnabled()) return false;
  if (action === 'getReservations') return true;
  if (action === 'getReservationById') return true;
  if (action === 'getRooms') return true;
  if (action === 'getOperationalChecks') return true;
  if (action === 'getOperationalMetrics') return true;
  return false;
}

function shouldServePostFromSupabase(action, body) {
  if (!isSupabaseWriteEnabled()) return false;
  if (action === 'createReservation') return true;
  if (action === 'verifyPassword') return true;
  if (action === 'updateReservation') return true;
  if (action === 'deleteReservation') return true;
  if (action === 'addRoom') return true;
  if (action === 'updateRoom') return true;
  if (action === 'deleteRoom') return true;
  return false;
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function getReservationTokenSecret() {
  return String(process.env.PROXY_TOKEN_SECRET || process.env.PROXY_SHARED_SECRET || '').trim();
}

function signReservationToken(reservationId) {
  const secret = getReservationTokenSecret();
  if (!secret) throw new Error('PROXY_TOKEN_SECRET is not set');

  const payload = {
    rid: String(reservationId),
    exp: Math.floor(Date.now() / 1000) + RESERVATION_TOKEN_TTL_SEC
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadStr);
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + sig;
}

function verifyReservationToken(token, reservationId) {
  const secret = getReservationTokenSecret();
  if (!secret) return { ok: false, error: '서버 토큰 설정이 누락되었습니다.' };

  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };

  const payloadB64 = parts[0];
  const providedSig = parts[1];
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch (e) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }

  if (!payload || String(payload.rid) !== String(reservationId)) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }
  if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }

  return { ok: true };
}

function signAdminToken() {
  const secret = getReservationTokenSecret();
  if (!secret) throw new Error('PROXY_TOKEN_SECRET is not set');

  const payload = {
    role: 'admin',
    exp: Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SEC
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return payloadB64 + '.' + sig;
}

function verifyAdminTokenLocal(token) {
  const secret = getReservationTokenSecret();
  if (!secret) return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };

  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };

  const payloadB64 = parts[0];
  const providedSig = parts[1];
  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (!payload || payload.role !== 'admin') return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '유효하지 않거나 만료된 인증 정보입니다.' };
  }
}

function hashPassword(password) {
  const pepper = String(process.env.PROXY_PASSWORD_PEPPER || '').trim();
  return createHash('sha256').update(String(password) + '|' + pepper, 'utf8').digest('hex');
}

function isPlaceholderHash(hash) {
  return String(hash || '') === '__PHASE_B_PLACEHOLDER__';
}

async function verifyPasswordViaUpstream(upstream, sharedSecret, id, password) {
  const body = { action: 'verifyPassword', id: String(id), password: String(password) };
  if (sharedSecret) {
    body.proxySecret = sharedSecret;
  }

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) return { ok: false };
  const payload = await res.json();
  return { ok: !!payload.success };
}

async function verifyAdminViaUpstream(upstream, sharedSecret, adminToken) {
  const u = new URL(upstream);
  u.searchParams.set('action', 'getRooms');
  u.searchParams.set('includeInactive', '1');
  u.searchParams.set('adminToken', String(adminToken || ''));
  if (sharedSecret) {
    u.searchParams.set('proxySecret', sharedSecret);
  }

  const res = await fetch(u.toString(), { method: 'GET', headers: { Accept: 'application/json' } });
  if (!res.ok) return { ok: false };
  const payload = await res.json();
  return { ok: !!payload.success };
}

async function verifyAdminAccess(adminToken, upstream, sharedSecret) {
  const localCheck = verifyAdminTokenLocal(adminToken || '');
  if (localCheck.ok) return { ok: true };
  if (isProxyAdminEnabled()) return localCheck;
  const upstreamCheck = await verifyAdminViaUpstream(upstream, sharedSecret, adminToken || '');
  return upstreamCheck.ok ? { ok: true } : { ok: false, error: '관리자 권한이 필요합니다.' };
}

function isoDay(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function listRecentDateKeys(days) {
  const keys = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

async function buildOperationalChecksFromSupabase(config) {
  const checks = [];

  const adminCodeConfigured = isProxyAdminEnabled();
  checks.push({ key: 'adminCode', ok: adminCodeConfigured, detail: adminCodeConfigured ? 'PROXY_ADMIN_CODE 설정됨' : 'PROXY_ADMIN_CODE 미설정' });

  const pepperConfigured = String(process.env.PROXY_PASSWORD_PEPPER || '').trim().length > 0;
  checks.push({ key: 'passwordPepper', ok: pepperConfigured, detail: pepperConfigured ? 'PROXY_PASSWORD_PEPPER 설정됨' : 'PROXY_PASSWORD_PEPPER 미설정' });

  const activeRooms = await supabaseSelect(config, 'rooms', { select: 'id,floor', is_active: 'eq.true' });
  checks.push({ key: 'activeRooms', ok: activeRooms.length > 0, detail: '활성 회의실 ' + activeRooms.length + '개' });

  const reservations = await supabaseSelect(config, 'reservations', { select: 'id,floor' });
  const activeFloors = new Set(activeRooms.map(function(r) { return normalizeFloor(r.floor || ''); }));
  const invalidRoomRefs = reservations.filter(function(r) { return !activeFloors.has(normalizeFloor(r.floor || '')); }).length;
  checks.push({ key: 'reservationRoomRef', ok: invalidRoomRefs === 0, detail: invalidRoomRefs === 0 ? '예약-회의실 참조 정상' : ('유효하지 않은 회의실 참조 예약 ' + invalidRoomRefs + '건') });

  const okCount = checks.filter(function(c) { return c.ok; }).length;
  return {
    total: checks.length,
    okCount: okCount,
    failCount: checks.length - okCount,
    checks: checks,
    allOk: okCount === checks.length
  };
}

async function buildOperationalMetricsFromSupabase(config, windowDays) {
  const days = Number(windowDays || 30);
  const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const reservations = await supabaseSelect(config, 'reservations', {
    select: 'id,date,created_at',
    order: 'created_at.asc'
  });

  const roomRows = await supabaseSelect(config, 'rooms', {
    select: 'id,is_active'
  });

  const auditRows = await supabaseSelect(config, 'audit_logs', {
    select: 'ts,action,result',
    ts: 'gte.' + windowStart,
    order: 'ts.asc'
  });

  const nowDay = new Date().toISOString().slice(0, 10);
  const inWindowReservations = reservations.filter(function(r) {
    return r.created_at && new Date(r.created_at).toISOString() >= windowStart;
  });

  let reservationUpdate = 0;
  let reservationDelete = 0;
  let passwordFail = 0;
  let adminFail = 0;
  let roomChanges = 0;

  (auditRows || []).forEach(function(row) {
    const action = String(row.action || '');
    const result = String(row.result || '');
    if (action === 'updateReservation' && result === 'success') reservationUpdate++;
    if (action === 'deleteReservation' && result === 'success') reservationDelete++;
    if (action === 'verifyPassword' && result === 'fail') passwordFail++;
    if (action === 'verifyAdmin' && result === 'fail') adminFail++;
    if ((action === 'addRoom' || action === 'updateRoom' || action === 'deleteRoom') && result === 'success') roomChanges++;
  });

  const activeRooms = roomRows.filter(function(r) { return !!r.is_active; }).length;
  const upcomingReservations = reservations.filter(function(r) { return String(r.date || '') >= nowDay; }).length;

  return {
    windowDays: days,
    reservationCreate: inWindowReservations.length,
    reservationUpdate: reservationUpdate,
    reservationDelete: reservationDelete,
    passwordFail: passwordFail,
    adminFail: adminFail,
    roomChanges: roomChanges,
    activeRooms: activeRooms,
    upcomingReservations: upcomingReservations
  };
}

async function findReservationById(config, id) {
  const rows = await supabaseSelect(config, 'reservations', {
    select: 'id,date,floor,start_time,end_time,team_name,user_name,password_hash,created_at',
    id: 'eq.' + String(id).trim(),
    limit: '1'
  });
  return rows.length ? rows[0] : null;
}

async function ensureActiveRoom(config, floor) {
  const rows = await supabaseSelect(config, 'rooms', {
    select: 'id',
    floor: 'eq.' + normalizeFloor(floor),
    is_active: 'eq.true',
    limit: '1'
  });
  return rows.length > 0;
}

async function hasTimeConflict(config, date, floor, startTime, endTime, excludeId) {
  const params = {
    select: 'id',
    date: 'eq.' + String(date),
    floor: 'eq.' + normalizeFloor(floor),
    start_time: 'lt.' + String(endTime),
    end_time: 'gt.' + String(startTime),
    limit: '1'
  };
  if (excludeId) {
    params.id = 'neq.' + String(excludeId);
  }
  const rows = await supabaseSelect(config, 'reservations', params);
  return rows.length > 0;
}

async function handleSupabaseGetAction(action, query, upstream, sharedSecret) {
  if (action === 'verifyAdmin' && isProxyAdminEnabled()) {
    const code = String(query.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 코드 형식이 올바르지 않습니다.' } };
    }
    if (code !== getProxyAdminCode()) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 인증에 실패했습니다.' } };
    }
    return { handled: true, status: 200, body: { success: true, token: signAdminToken(), message: '관리자 인증 성공' } };
  }

  const config = getSupabaseConfig();
  if (!config.url || !config.serviceRoleKey) {
    return { handled: true, status: 500, body: { success: false, error: 'Supabase read mode is enabled but configuration is missing.' } };
  }

  if (action === 'getRooms') {
    const includeInactive = parseBoolean(query.includeInactive);
    const params = {
      select: 'id,floor,name,is_active',
      order: 'floor.asc'
    };
    if (!includeInactive) {
      params.is_active = 'eq.true';
    } else {
      const adminCheck = verifyAdminTokenLocal(query.adminToken || '');
      if (!adminCheck.ok) {
        return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
      }
    }
    const rows = await supabaseSelect(config, 'rooms', params);
    return { handled: true, status: 200, body: { success: true, data: rows.map(mapRoomRecord) } };
  }

  if (action === 'getReservations') {
    const params = {
      select: 'id,date,floor,start_time,end_time,team_name,user_name,created_at',
      order: 'date.asc,start_time.asc'
    };
    if (isNonEmptyValue(query.date)) params.date = 'eq.' + String(query.date).trim();
    if (isNonEmptyValue(query.floor)) params.floor = 'eq.' + normalizeFloor(query.floor);
    const rows = await supabaseSelect(config, 'reservations', params);
    return { handled: true, status: 200, body: { success: true, data: rows.map(mapReservationRecord) } };
  }

  if (action === 'getReservationById') {
    const found = await findReservationById(config, query.id);
    if (!found) {
      return { handled: true, status: 200, body: { success: false, error: '예약을 찾을 수 없습니다.' } };
    }
    return { handled: true, status: 200, body: { success: true, data: mapReservationRecord(found) } };
  }

  if (action === 'getOperationalChecks') {
    const adminCheck = await verifyAdminAccess(query.adminToken || '', upstream, sharedSecret);
    if (!adminCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
    }
    const data = await buildOperationalChecksFromSupabase(config);
    return { handled: true, status: 200, body: { success: true, data: data } };
  }

  if (action === 'getOperationalMetrics') {
    const adminCheck = await verifyAdminAccess(query.adminToken || '', upstream, sharedSecret);
    if (!adminCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
    }
    const data = await buildOperationalMetricsFromSupabase(config, 30);
    return { handled: true, status: 200, body: { success: true, data: data } };
  }

  return { handled: false };
}

async function handleSupabasePostAction(action, body, upstream, sharedSecret) {
  const config = getSupabaseConfig();
  if (!config.url || !config.serviceRoleKey) {
    return { handled: true, status: 500, body: { success: false, error: 'Supabase write mode is enabled but configuration is missing.' } };
  }

  if (action === 'createReservation') {
    const safeDate = String(body.date || '').trim();
    const safeFloor = normalizeFloor(body.floor || '');
    const safeStart = String(body.startTime || '').trim();
    const safeEnd = String(body.endTime || '').trim();
    const safeTeamName = sanitizeText(body.teamName, 30);
    const safeUserName = sanitizeText(body.userName, 20);
    const password = String(body.password || '');

    if (!safeDate || !safeFloor || !safeStart || !safeEnd || !safeTeamName || !safeUserName || !password) {
      return { handled: true, status: 200, body: { success: false, error: '모든 필드를 입력해주세요.' } };
    }
    if (!isValidDateString(safeDate)) {
      return { handled: true, status: 200, body: { success: false, error: '날짜 형식이 올바르지 않습니다.' } };
    }
    if (!isValidTimeRange(safeStart, safeEnd)) {
      return { handled: true, status: 200, body: { success: false, error: '시간 범위가 올바르지 않습니다.' } };
    }
    if (!/^\d{4}$/.test(password)) {
      return { handled: true, status: 200, body: { success: false, error: '비밀번호는 숫자 4자리여야 합니다.' } };
    }

    const roomOk = await ensureActiveRoom(config, safeFloor);
    if (!roomOk) {
      return { handled: true, status: 200, body: { success: false, error: '선택한 회의실은 예약할 수 없습니다.' } };
    }

    const conflict = await hasTimeConflict(config, safeDate, safeFloor, safeStart, safeEnd, '');
    if (conflict) {
      return { handled: true, status: 200, body: { success: false, error: '해당 시간에 이미 예약이 있습니다.' } };
    }

    const id = createHash('sha1').update(safeDate + '|' + safeFloor + '|' + safeStart + '|' + safeEnd + '|' + Date.now()).digest('hex').slice(0, 12);
    await supabaseRequest(config, 'POST', 'reservations', {}, [{
      id,
      date: safeDate,
      floor: safeFloor,
      start_time: safeStart,
      end_time: safeEnd,
      team_name: safeTeamName,
      user_name: safeUserName,
      password_hash: hashPassword(password)
    }]);

    return {
      handled: true,
      status: 200,
      body: {
        success: true,
        data: {
          '예약ID': id,
          '날짜': safeDate,
          '층': safeFloor,
          '시작시간': safeStart,
          '종료시간': safeEnd,
          '팀명': safeTeamName,
          '예약자': safeUserName
        },
        message: '예약이 완료되었습니다.'
      }
    };
  }

  if (action === 'verifyPassword') {
    const id = String(body.id || '').trim();
    const password = String(body.password || '');
    const row = await findReservationById(config, id);
    if (!row) {
      return { handled: true, status: 200, body: { success: false, error: '예약을 찾을 수 없습니다.' } };
    }

    let matched = false;
    const inputHash = hashPassword(password);
    if (!isPlaceholderHash(row.password_hash)) {
      matched = String(row.password_hash || '') === inputHash;
    } else if (isStrictPasswordHashEnabled()) {
      return { handled: true, status: 200, body: { success: false, error: '비밀번호 마이그레이션이 완료되지 않은 예약입니다. 관리자에게 문의해주세요.' } };
    } else {
      const upstreamResult = await verifyPasswordViaUpstream(upstream, sharedSecret, id, password);
      matched = upstreamResult.ok;
    }

    if (!matched) {
      return { handled: true, status: 200, body: { success: false, error: '비밀번호가 일치하지 않습니다.' } };
    }

    const token = signReservationToken(id);
    return { handled: true, status: 200, body: { success: true, token, message: '인증 성공' } };
  }

  if (action === 'updateReservation') {
    const id = String(body.id || '').trim();
    const tokenCheck = verifyReservationToken(body.token, id);
    if (!tokenCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: tokenCheck.error } };
    }

    const row = await findReservationById(config, id);
    if (!row) {
      return { handled: true, status: 200, body: { success: false, error: '예약을 찾을 수 없습니다.' } };
    }

    const newDate = isNonEmptyValue(body.date) ? String(body.date).trim() : String(row.date || '');
    const newFloor = isNonEmptyValue(body.floor) ? normalizeFloor(body.floor) : normalizeFloor(row.floor || '');
    const newStart = isNonEmptyValue(body.startTime) ? String(body.startTime).trim() : String(row.start_time || '').slice(0, 5);
    const newEnd = isNonEmptyValue(body.endTime) ? String(body.endTime).trim() : String(row.end_time || '').slice(0, 5);
    const newTeam = body.teamName !== undefined ? sanitizeText(body.teamName, 30) : String(row.team_name || '');
    const newUser = body.userName !== undefined ? sanitizeText(body.userName, 20) : String(row.user_name || '');

    if (!isValidDateString(newDate)) {
      return { handled: true, status: 200, body: { success: false, error: '날짜 형식이 올바르지 않습니다.' } };
    }
    if (!isValidTimeRange(newStart, newEnd)) {
      return { handled: true, status: 200, body: { success: false, error: '시간 범위가 올바르지 않습니다.' } };
    }
    if (!newFloor || !newTeam || !newUser) {
      return { handled: true, status: 200, body: { success: false, error: '필수 값이 비어 있습니다.' } };
    }

    const roomOk = await ensureActiveRoom(config, newFloor);
    if (!roomOk) {
      return { handled: true, status: 200, body: { success: false, error: '선택한 회의실은 예약할 수 없습니다.' } };
    }

    const conflict = await hasTimeConflict(config, newDate, newFloor, newStart, newEnd, id);
    if (conflict) {
      return { handled: true, status: 200, body: { success: false, error: '해당 시간에 이미 예약이 있습니다.' } };
    }

    await supabaseRequest(config, 'PATCH', 'reservations', { id: 'eq.' + id }, {
      date: newDate,
      floor: newFloor,
      start_time: newStart,
      end_time: newEnd,
      team_name: newTeam,
      user_name: newUser
    });

    return { handled: true, status: 200, body: { success: true, message: '예약이 수정되었습니다.' } };
  }

  if (action === 'deleteReservation') {
    const id = String(body.id || '').trim();

    if (isNonEmptyValue(body.adminToken)) {
      const adminCheck = verifyAdminTokenLocal(body.adminToken || '');
      if (!adminCheck.ok) {
        return { handled: true, status: 200, body: { success: false, error: '유효하지 않거나 만료된 인증 정보입니다.' } };
      }
    } else {
      const tokenCheck = verifyReservationToken(body.token, id);
      if (!tokenCheck.ok) {
        return { handled: true, status: 200, body: { success: false, error: tokenCheck.error } };
      }
    }

    await supabaseRequest(config, 'DELETE', 'reservations', { id: 'eq.' + id });
    return { handled: true, status: 200, body: { success: true, message: '예약이 취소되었습니다.' } };
  }

  if (action === 'addRoom') {
    const adminCheck = verifyAdminTokenLocal(body.adminToken || '');
    if (!adminCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
    }
    const floor = normalizeFloor(body.floor || '');
    const name = sanitizeText(body.name, 50);
    if (!floor || !name) {
      return { handled: true, status: 200, body: { success: false, error: '층과 이름을 입력해주세요.' } };
    }

    const existing = await supabaseSelect(config, 'rooms', {
      select: 'id',
      id: 'eq.' + floor,
      limit: '1'
    });
    if (existing.length) {
      return { handled: true, status: 200, body: { success: false, error: '이미 존재하는 회의실 ID입니다.' } };
    }

    await supabaseRequest(config, 'POST', 'rooms', {}, [{ id: floor, floor, name, is_active: true }]);
    return { handled: true, status: 200, body: { success: true, message: '회의실이 추가되었습니다.' } };
  }

  if (action === 'updateRoom') {
    const adminCheck = verifyAdminTokenLocal(body.adminToken || '');
    if (!adminCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
    }
    const roomId = String(body.roomId || '').trim();
    if (!roomId) {
      return { handled: true, status: 200, body: { success: false, error: '회의실 ID가 필요합니다.' } };
    }

    const patch = {};
    if (body.name !== undefined) patch.name = sanitizeText(body.name, 50);
    if (body.active !== undefined) patch.is_active = !!body.active;
    if (!Object.keys(patch).length) {
      return { handled: true, status: 200, body: { success: false, error: '변경할 값이 없습니다.' } };
    }

    const existing = await supabaseSelect(config, 'rooms', { select: 'id', id: 'eq.' + roomId, limit: '1' });
    if (!existing.length) {
      return { handled: true, status: 200, body: { success: false, error: '회의실을 찾을 수 없습니다.' } };
    }

    await supabaseRequest(config, 'PATCH', 'rooms', { id: 'eq.' + roomId }, patch);
    return { handled: true, status: 200, body: { success: true, message: '회의실이 수정되었습니다.' } };
  }

  if (action === 'deleteRoom') {
    const adminCheck = verifyAdminTokenLocal(body.adminToken || '');
    if (!adminCheck.ok) {
      return { handled: true, status: 200, body: { success: false, error: '관리자 권한이 필요합니다.' } };
    }
    const roomId = String(body.roomId || '').trim();
    if (!roomId) {
      return { handled: true, status: 200, body: { success: false, error: '회의실 ID가 필요합니다.' } };
    }

    await supabaseRequest(config, 'DELETE', 'rooms', { id: 'eq.' + roomId });
    return { handled: true, status: 200, body: { success: true, message: '회의실이 삭제되었습니다.' } };
  }

  return { handled: false };
}

export default async function handler(req, res) {
  const upstream = process.env.APPS_SCRIPT_URL;
  const sharedSecret = (process.env.PROXY_SHARED_SECRET || '').trim();

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

    try {
      if (shouldServeGetFromSupabase(action, req.query || {})) {
        const supabaseResult = await handleSupabaseGetAction(action, req.query || {}, upstream, sharedSecret);
        if (supabaseResult.handled) {
          return res.status(supabaseResult.status).json(supabaseResult.body);
        }
      }
    } catch (e) {
      return res.status(502).json({ success: false, error: 'Supabase 조회 중 오류가 발생했습니다.' });
    }

    Object.keys(req.query || {}).forEach(function(key) {
      const value = req.query[key];
      if (Array.isArray(value)) {
        value.forEach(function(item) { target.searchParams.append(key, String(item)); });
        return;
      }
      if (value != null) {
        target.searchParams.set(key, String(value));
      }
    });

    if (sharedSecret) {
      target.searchParams.set('proxySecret', sharedSecret);
    }
  }

  if (req.method === 'POST') {
    const parsed = parseIncomingPostBody(req.body);
    if (!parsed || typeof parsed.action !== 'string' || !parsed.action.trim()) {
      return res.status(400).json({ success: false, error: 'POST 요청 본문에 action이 필요합니다.' });
    }

    const action = String(parsed.action).trim();
    const policy = ensurePostActionPolicy(action, parsed);
    if (!policy.ok) {
      return res.status(policy.status).json({ success: false, error: policy.error });
    }

    try {
      if (shouldServePostFromSupabase(action, parsed)) {
        const supabaseResult = await handleSupabasePostAction(action, parsed, upstream, sharedSecret);
        if (supabaseResult.handled) {
          return res.status(supabaseResult.status).json(supabaseResult.body);
        }
      }
    } catch (e) {
      return res.status(502).json({ success: false, error: 'Supabase 쓰기 처리 중 오류가 발생했습니다.' });
    }

    const nextBody = Object.assign({}, parsed);
    if (sharedSecret) {
      nextBody.proxySecret = sharedSecret;
    }
    requestBody = buildUpstreamPostBody(nextBody);
  }

  try {
    const upstreamResponse = await fetch(target.toString(), {
      method: req.method,
      headers: req.method === 'POST'
        ? { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'application/json' }
        : { Accept: 'application/json' },
      body: req.method === 'POST' ? requestBody : undefined
    });

    const text = await upstreamResponse.text();
    res.status(upstreamResponse.status);

    const contentType = upstreamResponse.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return res.json(JSON.parse(text));
      } catch (e) {
        return res.send(text);
      }
    }

    return res.send(text);
  } catch (err) {
    return res.status(502).json({ success: false, error: 'Upstream request failed.' });
  }
}
