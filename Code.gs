/**
 * J동 회의실 예약 시스템 - Google Apps Script 백엔드
 * Google Sheets를 데이터베이스로 사용
 */

// ─── 설정 ───────────────────────────────────────────────
const SHEET_NAME = '예약';
const ROOM_SHEET_NAME = '회의실';
const AUDIT_SHEET_NAME = 'Audit';
const LEGACY_ADMIN_CODE = '041082'; // 마이그레이션용 fallback (운영 시 Script Property 사용 권장)

const RESERVATION_TOKEN_TTL_SECONDS = 60 * 10; // 10분
const ADMIN_TOKEN_TTL_SECONDS = 60 * 30; // 30분
const TOKEN_PREFIX = 'token:';

const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_SECONDS = 60 * 5; // 5분
const AUTH_LOCK_SECONDS = 60 * 15; // 15분

const PROP_ADMIN_CODE = 'ADMIN_CODE';
const PROP_PASSWORD_PEPPER = 'PASSWORD_PEPPER';
const PROP_METRICS_REPORT_RECIPIENTS = 'METRICS_REPORT_RECIPIENTS';
const PROP_METRICS_REPORT_THRESHOLD_ADMIN_FAIL = 'METRICS_REPORT_THRESHOLD_ADMIN_FAIL';
const PROP_METRICS_REPORT_THRESHOLD_PASSWORD_FAIL = 'METRICS_REPORT_THRESHOLD_PASSWORD_FAIL';
const ALERT_WINDOW_MINUTES = 60;
const RESERVATION_LOCK_WAIT_MS = 5000;

// ─── 유틸리티 ───────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow([
      '예약ID', '날짜', '층', '시작시간', '종료시간',
      '팀명', '예약자', '비밀번호해시', '생성일시'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  return sheet;
}



function getAuditSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUDIT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AUDIT_SHEET_NAME);
    sheet.appendRow([
      '시각', '액션', '결과', '주체유형', '대상ID', '메모'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
  }
  return sheet;
}

function writeAudit(action, result, actorType, targetId, memo) {
  try {
    const sheet = getAuditSheet();
    const tz = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    sheet.appendRow([
      now,
      String(action || ''),
      String(result || ''),
      String(actorType || ''),
      String(targetId || ''),
      String(memo || '')
    ]);
  } catch (e) {
    // 감사 로그 실패는 서비스 가용성에 영향 주지 않음
  }
}

function getRoomSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ROOM_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(ROOM_SHEET_NAME);
    sheet.appendRow(['회의실ID', '층', '이름', '활성화']);
    sheet.setFrozenRows(1);
    sheet.getRange('1:1').setFontWeight('bold');
    sheet.appendRow(['6F', '6F', '미니 회의실', 'TRUE']);
    sheet.appendRow(['7F', '7F', '미니 회의실', 'TRUE']);
    sheet.appendRow(['8F', '8F', '미니 회의실', 'TRUE']);
    sheet.appendRow(['9F', '9F', '미니 회의실', 'TRUE']);
  }
  return sheet;
}

function generateId() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 12);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getScriptProperties() {
  return PropertiesService.getScriptProperties();
}

function getAdminCode() {
  const configured = (getScriptProperties().getProperty(PROP_ADMIN_CODE) || '').trim();
  return configured || LEGACY_ADMIN_CODE;
}

function getPasswordPepper() {
  return (getScriptProperties().getProperty(PROP_PASSWORD_PEPPER) || '').trim();
}

function getCache() {
  return CacheService.getScriptCache();
}

function getFailureKey(scope, identifier) {
  return 'authfail:' + scope + ':' + String(identifier || 'global');
}

function getLockKey(scope, identifier) {
  return 'authlock:' + scope + ':' + String(identifier || 'global');
}

function checkRateLimit(scope, identifier) {
  const lockKey = getLockKey(scope, identifier);
  const lockUntil = getCache().get(lockKey);
  if (lockUntil) {
    return { ok: false, error: '인증 시도 횟수가 초과되었습니다. 잠시 후 다시 시도하세요.' };
  }
  return { ok: true };
}

function recordAuthFailure(scope, identifier) {
  const failKey = getFailureKey(scope, identifier);
  const lockKey = getLockKey(scope, identifier);
  const current = parseInt(getCache().get(failKey) || '0', 10);
  const next = current + 1;

  getCache().put(failKey, String(next), AUTH_WINDOW_SECONDS);

  if (next >= MAX_AUTH_ATTEMPTS) {
    getCache().put(lockKey, String(Date.now() + AUTH_LOCK_SECONDS * 1000), AUTH_LOCK_SECONDS);
    getCache().remove(failKey);
  }
}

function clearAuthFailure(scope, identifier) {
  getCache().remove(getFailureKey(scope, identifier));
  getCache().remove(getLockKey(scope, identifier));
}

function generateToken() {
  return Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '') +
    Math.floor(Math.random() * 1e9).toString(16);
}

function setTokenPayload(token, payload, ttlSeconds) {
  getCache().put(TOKEN_PREFIX + token, JSON.stringify(payload), ttlSeconds);
}

function getTokenPayload(token) {
  if (!token) return null;
  const raw = getCache().get(TOKEN_PREFIX + token);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function deleteToken(token) {
  if (!token) return;
  getCache().remove(TOKEN_PREFIX + token);
}

function issueReservationToken(reservationId) {
  const token = generateToken();
  setTokenPayload(token, {
    type: 'reservation',
    reservationId: String(reservationId),
    issuedAt: new Date().toISOString()
  }, RESERVATION_TOKEN_TTL_SECONDS);
  return token;
}

function issueAdminToken() {
  const token = generateToken();
  setTokenPayload(token, {
    type: 'admin',
    issuedAt: new Date().toISOString()
  }, ADMIN_TOKEN_TTL_SECONDS);
  return token;
}

function verifyReservationToken(token, reservationId) {
  const payload = getTokenPayload(token);
  if (!payload || payload.type !== 'reservation') {
    return { ok: false, error: '유효하지 않거나 만료된 토큰입니다.' };
  }
  if (String(payload.reservationId) !== String(reservationId)) {
    return { ok: false, error: '해당 예약에 대한 권한이 없습니다.' };
  }
  return { ok: true, payload: payload };
}

function verifyAdminToken(adminToken) {
  const payload = getTokenPayload(adminToken);
  if (!payload || payload.type !== 'admin') {
    return { ok: false, error: '유효하지 않거나 만료된 관리자 토큰입니다.' };
  }
  return { ok: true, payload: payload };
}

function normalizeDateValue(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value);
}

function normalizeTimeValue(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(value);
}

function normalizeFloorValue(value) {
  return String(value || '').trim().toUpperCase();
}

function isReservableRoom(floor) {
  const target = normalizeFloorValue(floor);
  if (!target) return false;

  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    const rowFloor = normalizeFloorValue(rows[i][1]);
    const active = String(rows[i][3]).toUpperCase() === 'TRUE';
    if (rowFloor === target && active) return true;
  }
  return false;
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTimeString(value) {
  return /^([01]\d|2[0-3]):(00|30)$/.test(String(value || ''));
}

function isValidTimeRange(startTime, endTime) {
  const start = normalizeTimeValue(startTime);
  const end = normalizeTimeValue(endTime);
  return isValidTimeString(start) && isValidTimeString(end) && start < end;
}

function sanitizeText(value, maxLength) {
  const v = String(value || '').trim();
  if (!v) return '';
  return v.substring(0, maxLength);
}

function withReservationLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(RESERVATION_LOCK_WAIT_MS);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

// ─── SHA-256 해싱 ───────────────────────────────────────
function hashPassword(password) {
  const pepper = getPasswordPepper();
  const source = String(password) + '|' + pepper;
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, source);
  return raw.map(function(b) {
    let hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ─── GET 요청 핸들러 ────────────────────────────────────


function getSecurityAlerts(params) {
  const adminToken = params && params.adminToken ? params.adminToken : '';
  const adminCheck = verifyAdminToken(adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  const sheet = getAuditSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  const now = Date.now();
  const windowMs = ALERT_WINDOW_MINUTES * 60 * 1000;
  let adminFailCount = 0;
  let reservationFailCount = 0;
  const byReservation = {};

  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    const ts = new Date(row[0]).getTime();
    if (isNaN(ts)) continue;
    if ((now - ts) > windowMs) break;

    const action = String(row[1] || '');
    const result = String(row[2] || '');
    const targetId = String(row[4] || '');

    if (action === 'verifyAdmin' && result === 'fail') {
      adminFailCount++;
      continue;
    }
    if (action === 'verifyPassword' && result === 'fail') {
      reservationFailCount++;
      if (targetId) {
        byReservation[targetId] = (byReservation[targetId] || 0) + 1;
      }
    }
  }

  const hotReservations = Object.keys(byReservation)
    .map(function(id) { return { reservationId: id, failCount: byReservation[id] }; })
    .filter(function(item) { return item.failCount >= 3; })
    .sort(function(a, b) { return b.failCount - a.failCount; })
    .slice(0, 10);

  return jsonResponse({
    success: true,
    data: {
      windowMinutes: ALERT_WINDOW_MINUTES,
      adminFailCount: adminFailCount,
      reservationFailCount: reservationFailCount,
      hotReservations: hotReservations,
      hasAlert: adminFailCount >= 5 || hotReservations.length > 0
    }
  });
}


function getOperationalChecks(params) {
  const adminToken = params && params.adminToken ? params.adminToken : '';
  const adminCheck = verifyAdminToken(adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  const checks = [];

  const adminCodeConfigured = (getScriptProperties().getProperty(PROP_ADMIN_CODE) || '').trim().length > 0;
  checks.push({ key: 'adminCode', ok: adminCodeConfigured, detail: adminCodeConfigured ? 'ADMIN_CODE 설정됨' : 'ADMIN_CODE 미설정(legacy fallback 사용 중)' });

  const pepperConfigured = (getScriptProperties().getProperty(PROP_PASSWORD_PEPPER) || '').trim().length > 0;
  checks.push({ key: 'passwordPepper', ok: pepperConfigured, detail: pepperConfigured ? 'PASSWORD_PEPPER 설정됨' : 'PASSWORD_PEPPER 미설정' });

  const roomData = getRoomSheet().getDataRange().getValues().slice(1);
  const activeRooms = roomData.filter(function(row) { return String(row[3]).toUpperCase() === 'TRUE'; }).length;
  checks.push({ key: 'activeRooms', ok: activeRooms > 0, detail: '활성 회의실 ' + activeRooms + '개' });

  const reservationRows = getSheet().getDataRange().getValues().slice(1);
  let invalidRoomRefs = 0;
  reservationRows.forEach(function(row) {
    if (!isReservableRoom(row[2])) invalidRoomRefs++;
  });
  checks.push({ key: 'reservationRoomRef', ok: invalidRoomRefs === 0, detail: invalidRoomRefs === 0 ? '예약-회의실 참조 정상' : ('유효하지 않은 회의실 참조 예약 ' + invalidRoomRefs + '건') });

  const okCount = checks.filter(function(c) { return c.ok; }).length;
  return jsonResponse({
    success: true,
    data: {
      total: checks.length,
      okCount: okCount,
      failCount: checks.length - okCount,
      checks: checks,
      allOk: okCount === checks.length
    }
  });
}


function getOperationalMetrics(params) {
  const adminToken = params && params.adminToken ? params.adminToken : '';
  const adminCheck = verifyAdminToken(adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  return jsonResponse({
    success: true,
    data: buildOperationalMetricsSnapshot(30)
  });
}

function getMetricsReportRecipients() {
  const raw = String(getScriptProperties().getProperty(PROP_METRICS_REPORT_RECIPIENTS) || '');
  if (!raw) return [];
  return raw
    .split(/[;,\n]/)
    .map(function(item) { return item.trim(); })
    .filter(function(item) { return item.length > 0; });
}

function getNumericProperty(key, defaultValue) {
  const raw = String(getScriptProperties().getProperty(key) || '').trim();
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function buildOperationalMetricsSnapshot(windowDays) {
  const effectiveWindowDays = Number(windowDays || 30);
  const windowMs = effectiveWindowDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();

  let reservationCreate = 0;
  let reservationUpdate = 0;
  let reservationDelete = 0;
  let passwordFail = 0;
  let adminFail = 0;
  let roomChanges = 0;

  const auditRows = getAuditSheet().getDataRange().getValues().slice(1);
  auditRows.forEach(function(row) {
    const ts = new Date(row[0]).getTime();
    if (isNaN(ts) || (nowMs - ts) > windowMs) return;

    const action = String(row[1] || '');
    const result = String(row[2] || '');

    if (action === 'createReservation' && result === 'success') reservationCreate++;
    if (action === 'updateReservation' && result === 'success') reservationUpdate++;
    if (action === 'deleteReservation' && result === 'success') reservationDelete++;
    if (action === 'verifyPassword' && result === 'fail') passwordFail++;
    if (action === 'verifyAdmin' && result === 'fail') adminFail++;
    if ((action === 'addRoom' || action === 'updateRoom' || action === 'deleteRoom') && result === 'success') roomChanges++;
  });

  const roomRows = getRoomSheet().getDataRange().getValues().slice(1);
  const activeRooms = roomRows.filter(function(row) { return String(row[3]).toUpperCase() === 'TRUE'; }).length;

  const reservationRows = getSheet().getDataRange().getValues().slice(1);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const upcomingReservations = reservationRows.filter(function(row) {
    return normalizeDateValue(row[1]) >= today;
  }).length;

  return {
    windowDays: effectiveWindowDays,
    reservationCreate: reservationCreate,
    reservationUpdate: reservationUpdate,
    reservationDelete: reservationDelete,
    passwordFail: passwordFail,
    adminFail: adminFail,
    roomChanges: roomChanges,
    activeRooms: activeRooms,
    upcomingReservations: upcomingReservations
  };
}


function listRecentDateKeys(days, tz) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - (i * 24 * 60 * 60 * 1000));
    keys.push(Utilities.formatDate(d, tz, 'yyyy-MM-dd'));
  }
  return keys;
}

function buildOperationalMetricsTrend(windowDays) {
  const effectiveWindowDays = Number(windowDays || 30);
  const tz = Session.getScriptTimeZone();
  const dayKeys = listRecentDateKeys(effectiveWindowDays, tz);
  const daySet = {};
  dayKeys.forEach(function(day) { daySet[day] = true; });

  const createByDay = {};
  const passwordFailByDay = {};
  const adminFailByDay = {};
  dayKeys.forEach(function(day) {
    createByDay[day] = 0;
    passwordFailByDay[day] = 0;
    adminFailByDay[day] = 0;
  });

  const auditRows = getAuditSheet().getDataRange().getValues().slice(1);
  auditRows.forEach(function(row) {
    const ts = new Date(row[0]);
    if (isNaN(ts.getTime())) return;

    const day = Utilities.formatDate(ts, tz, 'yyyy-MM-dd');
    if (!daySet[day]) return;

    const action = String(row[1] || '');
    const result = String(row[2] || '');

    if (action === 'createReservation' && result === 'success') createByDay[day]++;
    if (action === 'verifyPassword' && result === 'fail') passwordFailByDay[day]++;
    if (action === 'verifyAdmin' && result === 'fail') adminFailByDay[day]++;
  });

  const createSeries = dayKeys.map(function(day) { return createByDay[day] || 0; });
  const authFailSeries = dayKeys.map(function(day) { return (passwordFailByDay[day] || 0) + (adminFailByDay[day] || 0); });
  const movingAvg7 = authFailSeries.map(function(_, idx) {
    const start = Math.max(0, idx - 6);
    const slice = authFailSeries.slice(start, idx + 1);
    const sum = slice.reduce(function(acc, n) { return acc + n; }, 0);
    return Math.round((sum / slice.length) * 100) / 100;
  });

  return {
    windowDays: effectiveWindowDays,
    days: dayKeys,
    series: {
      reservationCreate: createSeries,
      authFail: authFailSeries,
      authFailMovingAvg7: movingAvg7
    }
  };
}

function getOperationalMetricsTrend(params) {
  const adminToken = params && params.adminToken ? params.adminToken : '';
  const adminCheck = verifyAdminToken(adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  return jsonResponse({
    success: true,
    data: buildOperationalMetricsTrend(30)
  });
}

function buildOperationalMetricsReport(metrics, options) {
  const tz = Session.getScriptTimeZone();
  const generatedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const windowDays = Number(metrics.windowDays || 30);
  const thresholdAdminFail = Number(options && options.thresholdAdminFail || 10);
  const thresholdPasswordFail = Number(options && options.thresholdPasswordFail || 20);
  const hasAlert = Number(metrics.adminFail || 0) >= thresholdAdminFail || Number(metrics.passwordFail || 0) >= thresholdPasswordFail;
  const status = hasAlert ? '주의 필요' : '정상';

  const lines = [
    '[J동 회의실 예약] 월간 운영 리포트',
    '',
    '생성 시각: ' + generatedAt,
    '집계 기간: 최근 ' + windowDays + '일',
    '상태: ' + status,
    '',
    '- 예약 생성: ' + Number(metrics.reservationCreate || 0) + '건',
    '- 예약 수정: ' + Number(metrics.reservationUpdate || 0) + '건',
    '- 예약 삭제: ' + Number(metrics.reservationDelete || 0) + '건',
    '- 예약 비밀번호 실패: ' + Number(metrics.passwordFail || 0) + '건 (임계치 ' + thresholdPasswordFail + ')',
    '- 관리자 인증 실패: ' + Number(metrics.adminFail || 0) + '건 (임계치 ' + thresholdAdminFail + ')',
    '- 회의실 변경 작업: ' + Number(metrics.roomChanges || 0) + '건',
    '- 활성 회의실: ' + Number(metrics.activeRooms || 0) + '개',
    '- 예정 예약: ' + Number(metrics.upcomingReservations || 0) + '건',
    '',
    '※ 임계치 조정: Script Property ' + PROP_METRICS_REPORT_THRESHOLD_ADMIN_FAIL + ', ' + PROP_METRICS_REPORT_THRESHOLD_PASSWORD_FAIL,
    '※ 수신자 설정: Script Property ' + PROP_METRICS_REPORT_RECIPIENTS + ' (쉼표/세미콜론/줄바꿈 구분)'
  ];

  return {
    generatedAt: generatedAt,
    status: status,
    hasAlert: hasAlert,
    text: lines.join('\n')
  };
}

function getOperationalMetricsReport(params) {
  const adminToken = params && params.adminToken ? params.adminToken : '';
  const adminCheck = verifyAdminToken(adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  const metrics = buildOperationalMetricsSnapshot(30);
  const thresholdAdminFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_ADMIN_FAIL, 10);
  const thresholdPasswordFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_PASSWORD_FAIL, 20);
  const report = buildOperationalMetricsReport(metrics, {
    thresholdAdminFail: thresholdAdminFail,
    thresholdPasswordFail: thresholdPasswordFail
  });

  return jsonResponse({
    success: true,
    data: {
      reportText: report.text,
      hasAlert: report.hasAlert,
      status: report.status,
      thresholds: {
        adminFail: thresholdAdminFail,
        passwordFail: thresholdPasswordFail
      },
      recipients: getMetricsReportRecipients()
    }
  });
}

function sendOperationalMetricsReport(body) {
  const adminCheck = verifyAdminToken(body.adminToken || '');
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
  }

  const recipients = getMetricsReportRecipients();
  if (recipients.length === 0) {
    return jsonResponse({ success: false, error: 'METRICS_REPORT_RECIPIENTS 설정이 필요합니다.' });
  }

  const thresholdAdminFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_ADMIN_FAIL, 10);
  const thresholdPasswordFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_PASSWORD_FAIL, 20);
  const metrics = buildOperationalMetricsSnapshot(30);
  const report = buildOperationalMetricsReport(metrics, {
    thresholdAdminFail: thresholdAdminFail,
    thresholdPasswordFail: thresholdPasswordFail
  });

  const subjectPrefix = report.hasAlert ? '[주의]' : '[정상]';
  const subject = subjectPrefix + ' J동 회의실 월간 운영 리포트';
  const to = recipients.join(',');

  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: report.text
  });

  writeAudit('sendOperationalMetricsReport', 'success', 'admin', to, 'status=' + report.status);
  return jsonResponse({ success: true, data: { recipients: recipients, status: report.status } });
}

function runScheduledOperationalMetricsReport() {
  const recipients = getMetricsReportRecipients();
  if (recipients.length === 0) {
    writeAudit('sendOperationalMetricsReport', 'skip', 'system', '', 'METRICS_REPORT_RECIPIENTS not configured');
    return;
  }

  const thresholdAdminFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_ADMIN_FAIL, 10);
  const thresholdPasswordFail = getNumericProperty(PROP_METRICS_REPORT_THRESHOLD_PASSWORD_FAIL, 20);
  const metrics = buildOperationalMetricsSnapshot(30);
  const report = buildOperationalMetricsReport(metrics, {
    thresholdAdminFail: thresholdAdminFail,
    thresholdPasswordFail: thresholdPasswordFail
  });
  const subjectPrefix = report.hasAlert ? '[주의]' : '[정상]';

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: subjectPrefix + ' J동 회의실 월간 운영 리포트(자동 발송)',
    body: report.text
  });

  writeAudit('sendOperationalMetricsReport', 'success', 'system', recipients.join(','), 'scheduled status=' + report.status);
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'getReservations';

  try {
    switch (action) {
      case 'getReservations':
        return getReservations(params);
      case 'getReservationById':
        return getReservationById(params);
      case 'getRooms':
        return getRooms(params);
      case 'verifyAdmin':
        return verifyAdmin(params);
      case 'getSecurityAlerts':
        return getSecurityAlerts(params);
      case 'getOperationalChecks':
        return getOperationalChecks(params);
      case 'getOperationalMetrics':
        return getOperationalMetrics(params);
      case 'getOperationalMetricsReport':
        return getOperationalMetricsReport(params);
      case 'getOperationalMetricsTrend':
        return getOperationalMetricsTrend(params);
      default:
        return jsonResponse({ success: false, error: '알 수 없는 액션입니다.' });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: '서버 처리 중 오류가 발생했습니다.' });
  }
}

// ─── POST 요청 핸들러 ───────────────────────────────────
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: '잘못된 요청 형식입니다.' });
  }

  const action = body.action || '';

  try {
    switch (action) {
      case 'createReservation':
        return createReservation(body);
      case 'updateReservation':
        return updateReservation(body);
      case 'deleteReservation':
        return deleteReservation(body);
      case 'verifyPassword':
        return verifyPassword(body);
      case 'addRoom':
        return addRoom(body);
      case 'updateRoom':
        return updateRoom(body);
      case 'deleteRoom':
        return deleteRoom(body);
      case 'sendOperationalMetricsReport':
        return sendOperationalMetricsReport(body);
      default:
        return jsonResponse({ success: false, error: '알 수 없는 액션입니다.' });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: '서버 처리 중 오류가 발생했습니다.' });
  }
}

// ─── 예약 조회 ──────────────────────────────────────────
function getReservations(params) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  let results = rows.map(function(row) {
    let obj = {};
    headers.forEach(function(h, i) {
      if (h !== '비밀번호해시') {
        let val = row[i];
        if (h === '날짜' && val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        }
        if ((h === '시작시간' || h === '종료시간') && val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'HH:mm');
        }
        obj[h] = val;
      }
    });
    return obj;
  });

  if (params.date) {
    results = results.filter(function(r) {
      return String(r['날짜']) === String(params.date);
    });
  }

  if (params.floor) {
    const targetFloor = normalizeFloorValue(params.floor);
    results = results.filter(function(r) {
      return normalizeFloorValue(r['층']) === targetFloor;
    });
  }

  return jsonResponse({ success: true, data: results });
}

// ─── 특정 예약 조회 ────────────────────────────────────
function getReservationById(params) {
  const id = params.id;
  if (!id) {
    return jsonResponse({ success: false, error: '예약 ID가 필요합니다.' });
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  const tz = Session.getScriptTimeZone();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      let obj = {};
      headers.forEach(function(h, idx) {
        if (h !== '비밀번호해시') {
          let val = rows[i][idx];
          if (h === '날짜' && val instanceof Date) {
            val = Utilities.formatDate(val, tz, 'yyyy-MM-dd');
          }
          if ((h === '시작시간' || h === '종료시간') && val instanceof Date) {
            val = Utilities.formatDate(val, tz, 'HH:mm');
          }
          obj[h] = val;
        }
      });
      return jsonResponse({ success: true, data: obj });
    }
  }

  return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
}

// ─── 예약 생성 ──────────────────────────────────────────
function createReservation(body) {
  const { date, floor, startTime, endTime, teamName, userName, password } = body;

  const safeTeamName = sanitizeText(teamName, 30);
  const safeUserName = sanitizeText(userName, 20);
  const safeFloor = normalizeFloorValue(floor);
  const safeDate = normalizeDateValue(date);
  const safeStart = normalizeTimeValue(startTime);
  const safeEnd = normalizeTimeValue(endTime);

  if (!safeDate || !safeFloor || !safeStart || !safeEnd || !safeTeamName || !safeUserName || !password) {
    return jsonResponse({ success: false, error: '모든 필드를 입력해주세요.' });
  }

  if (!isValidDateString(safeDate)) {
    return jsonResponse({ success: false, error: '날짜 형식이 올바르지 않습니다.' });
  }

  if (!isValidTimeRange(safeStart, safeEnd)) {
    return jsonResponse({ success: false, error: '시간 범위가 올바르지 않습니다.' });
  }

  if (!isReservableRoom(safeFloor)) {
    return jsonResponse({ success: false, error: '선택한 회의실은 예약할 수 없습니다.' });
  }

  if (!/^\d{4}$/.test(password)) {
    return jsonResponse({ success: false, error: '비밀번호는 4자리 숫자여야 합니다.' });
  }

  return withReservationLock(function() {
    const conflict = checkTimeConflict(safeDate, safeFloor, safeStart, safeEnd);
    if (conflict) {
      return jsonResponse({ success: false, error: '해당 시간에 이미 예약이 있습니다.' });
    }

    const sheet = getSheet();
    const id = generateId();
    const passwordHash = hashPassword(password);
    const createdAt = new Date().toISOString();

    sheet.appendRow([id, safeDate, safeFloor, safeStart, safeEnd, safeTeamName, safeUserName, passwordHash, createdAt]);

    writeAudit('createReservation', 'success', 'user', id, safeDate + ' ' + safeFloor + ' ' + safeStart + '~' + safeEnd);
    return jsonResponse({
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
    });
  });
}

// ─── 시간 충돌 확인 ─────────────────────────────────────
function checkTimeConflict(date, floor, startTime, endTime, excludeId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  const targetDate = normalizeDateValue(date);
  const targetFloor = normalizeFloorValue(floor);
  const targetStart = normalizeTimeValue(startTime);
  const targetEnd = normalizeTimeValue(endTime);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (excludeId && String(row[0]) === String(excludeId)) continue;

    const rowDate = normalizeDateValue(row[1]);
    const rowFloor = normalizeFloorValue(row[2]);
    if (rowDate !== targetDate || rowFloor !== targetFloor) continue;

    const existStart = normalizeTimeValue(row[3]);
    const existEnd = normalizeTimeValue(row[4]);

    if (targetStart < existEnd && targetEnd > existStart) {
      return true;
    }
  }
  return false;
}

// ─── 비밀번호 검증(토큰 발급) ───────────────────────────
function verifyPassword(body) {
  const { id, password } = body;

  if (!id || !password) {
    return jsonResponse({ success: false, error: 'ID와 비밀번호가 필요합니다.' });
  }

  const limiter = checkRateLimit('reservation', id);
  if (!limiter.ok) {
    return jsonResponse({ success: false, error: limiter.error });
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const storedHash = rows[i][7];
      const inputHash = hashPassword(password);

      if (storedHash !== inputHash) {
        recordAuthFailure('reservation', id);
        writeAudit('verifyPassword', 'fail', 'user', id, 'password mismatch');
        return jsonResponse({ success: false, error: '비밀번호가 일치하지 않습니다.' });
      }

      clearAuthFailure('reservation', id);
      const token = issueReservationToken(id);
      writeAudit('verifyPassword', 'success', 'user', id, '');
      return jsonResponse({ success: true, token: token, message: '인증 성공' });
    }
  }

  recordAuthFailure('reservation', id);
  writeAudit('verifyPassword', 'fail', 'user', id, 'reservation not found');
  return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
}

// ─── 예약 수정(토큰 인증) ────────────────────────────────
function updateReservation(body) {
  const { id, token, date, floor, startTime, endTime, teamName, userName } = body;

  if (!id || !token) {
    return jsonResponse({ success: false, error: 'ID와 토큰이 필요합니다.' });
  }

  const tokenCheck = verifyReservationToken(token, id);
  if (!tokenCheck.ok) {
    return jsonResponse({ success: false, error: tokenCheck.error });
  }

  return withReservationLock(function() {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const rows = data.slice(1);

    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        const currentDate = normalizeDateValue(rows[i][1]);
        const currentFloor = normalizeFloorValue(rows[i][2]);
        const currentStart = normalizeTimeValue(rows[i][3]);
        const currentEnd = normalizeTimeValue(rows[i][4]);

        const newDate = date ? normalizeDateValue(date) : currentDate;
        const newFloor = floor ? normalizeFloorValue(floor) : currentFloor;
        const newStart = startTime ? normalizeTimeValue(startTime) : currentStart;
        const newEnd = endTime ? normalizeTimeValue(endTime) : currentEnd;
        const newTeamName = teamName !== undefined ? sanitizeText(teamName, 30) : String(rows[i][5]);
        const newUserName = userName !== undefined ? sanitizeText(userName, 20) : String(rows[i][6]);

        if (!isValidDateString(newDate)) {
          return jsonResponse({ success: false, error: '날짜 형식이 올바르지 않습니다.' });
        }

        if (!isValidTimeRange(newStart, newEnd)) {
          return jsonResponse({ success: false, error: '시간 범위가 올바르지 않습니다.' });
        }

        if (!newFloor || !newTeamName || !newUserName) {
          return jsonResponse({ success: false, error: '필수 값이 비어 있습니다.' });
        }

        if (!isReservableRoom(newFloor)) {
          return jsonResponse({ success: false, error: '선택한 회의실은 예약할 수 없습니다.' });
        }

        const conflict = checkTimeConflict(newDate, newFloor, newStart, newEnd, id);
        if (conflict) {
          return jsonResponse({ success: false, error: '해당 시간에 이미 예약이 있습니다.' });
        }

        const rowIndex = i + 2;
        sheet.getRange(rowIndex, 2).setValue(newDate);
        sheet.getRange(rowIndex, 3).setValue(newFloor);
        sheet.getRange(rowIndex, 4).setValue(newStart);
        sheet.getRange(rowIndex, 5).setValue(newEnd);
        sheet.getRange(rowIndex, 6).setValue(newTeamName);
        sheet.getRange(rowIndex, 7).setValue(newUserName);

        // 민감 작업 완료 후 토큰 폐기(재사용 방지)
        deleteToken(token);
        writeAudit('updateReservation', 'success', 'user', id, newDate + ' ' + newFloor + ' ' + newStart + '~' + newEnd);
        return jsonResponse({ success: true, message: '예약이 수정되었습니다.' });
      }
    }

    return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
  });
}

// ─── 예약 삭제(토큰 인증: token 또는 adminToken) ─────────
function deleteReservation(body) {
  const { id, token, adminToken } = body;

  if (!id || (!token && !adminToken)) {
    return jsonResponse({ success: false, error: 'ID와 토큰이 필요합니다.' });
  }

  let authorized = false;
  let usedReservationToken = false;

  if (adminToken) {
    const adminCheck = verifyAdminToken(adminToken);
    if (adminCheck.ok) {
      authorized = true;
    }
  }

  if (!authorized && token) {
    const tokenCheck = verifyReservationToken(token, id);
    if (tokenCheck.ok) {
      authorized = true;
      usedReservationToken = true;
    } else if (!adminToken) {
      return jsonResponse({ success: false, error: tokenCheck.error });
    }
  }

  if (!authorized) {
    return jsonResponse({ success: false, error: '유효하지 않거나 만료된 인증 정보입니다.' });
  }

  return withReservationLock(function() {
    const sheet = getSheet();
    const data = sheet.getDataRange().getValues();
    const rows = data.slice(1);

    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(id)) {
        sheet.deleteRow(i + 2);
        if (usedReservationToken) {
          deleteToken(token);
        }
        writeAudit('deleteReservation', 'success', usedReservationToken ? 'user' : 'admin', id, '');
        return jsonResponse({ success: true, message: '예약이 삭제되었습니다.' });
      }
    }

    return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
  });
}

// ─── 관리자 인증(토큰 발급) ─────────────────────────────
function verifyAdmin(params) {
  const code = params.code || '';

  const limiter = checkRateLimit('admin', 'global');
  if (!limiter.ok) {
    return jsonResponse({ success: false, error: limiter.error });
  }

  if (!/^\d{6}$/.test(code)) {
    recordAuthFailure('admin', 'global');
    return jsonResponse({ success: false, error: '관리자 코드 형식이 올바르지 않습니다.' });
  }

  const adminCode = getAdminCode();
  if (code === adminCode) {
    clearAuthFailure('admin', 'global');
    const token = issueAdminToken();
    writeAudit('verifyAdmin', 'success', 'admin', 'global', '');
    return jsonResponse({ success: true, token: token, message: '관리자 인증 성공' });
  }

  recordAuthFailure('admin', 'global');
  writeAudit('verifyAdmin', 'fail', 'admin', 'global', 'code mismatch');
  return jsonResponse({ success: false, error: '관리자 인증에 실패했습니다.' });
}

// ─── 회의실 조회 ────────────────────────────────────────
function getRooms(params) {
  const includeInactive = params && String(params.includeInactive || '') === '1';

  if (includeInactive) {
    const adminCheck = verifyAdminToken(params.adminToken || '');
    if (!adminCheck.ok) {
      return jsonResponse({ success: false, error: '관리자 권한이 필요합니다.' });
    }
  }

  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  let results = rows.map(function(row) {
    let obj = {};
    headers.forEach(function(h, i) {
      obj[h] = row[i];
    });
    obj['활성화'] = String(obj['활성화']).toUpperCase() === 'TRUE';
    return obj;
  });

  if (!includeInactive) {
    results = results.filter(function(room) {
      return room['활성화'] === true;
    });
  }

  return jsonResponse({ success: true, data: results });
}

// ─── 회의실 추가 (adminToken 인증) ──────────────────────
function addRoom(body) {
  const adminCheck = verifyAdminToken(body.adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: adminCheck.error });
  }

  const { floor, name } = body;
  if (!floor || !name) {
    return jsonResponse({ success: false, error: '층과 이름을 입력해주세요.' });
  }

  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(floor)) {
      return jsonResponse({ success: false, error: '이미 존재하는 회의실 ID입니다.' });
    }
  }

  sheet.appendRow([floor, floor, name, 'TRUE']);
  writeAudit('addRoom', 'success', 'admin', floor, name);
  return jsonResponse({ success: true, message: '회의실이 추가되었습니다.' });
}

// ─── 회의실 수정 (adminToken 인증) ──────────────────────
function updateRoom(body) {
  const adminCheck = verifyAdminToken(body.adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: adminCheck.error });
  }

  const { roomId, name, active } = body;
  if (!roomId) {
    return jsonResponse({ success: false, error: '회의실 ID가 필요합니다.' });
  }

  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(roomId)) {
      const rowIndex = i + 2;
      if (name !== undefined) {
        sheet.getRange(rowIndex, 3).setValue(name);
      }
      if (active !== undefined) {
        sheet.getRange(rowIndex, 4).setValue(active ? 'TRUE' : 'FALSE');
      }
      writeAudit('updateRoom', 'success', 'admin', roomId, (name !== undefined ? String(name) : '') + ' active=' + String(active));
      return jsonResponse({ success: true, message: '회의실이 수정되었습니다.' });
    }
  }

  return jsonResponse({ success: false, error: '회의실을 찾을 수 없습니다.' });
}

// ─── 회의실 삭제 (adminToken 인증) ──────────────────────
function deleteRoom(body) {
  const adminCheck = verifyAdminToken(body.adminToken);
  if (!adminCheck.ok) {
    return jsonResponse({ success: false, error: adminCheck.error });
  }

  const { roomId } = body;
  if (!roomId) {
    return jsonResponse({ success: false, error: '회의실 ID가 필요합니다.' });
  }

  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(roomId)) {
      sheet.deleteRow(i + 2);
      writeAudit('deleteRoom', 'success', 'admin', roomId, '');
      return jsonResponse({ success: true, message: '회의실이 삭제되었습니다.' });
    }
  }

  return jsonResponse({ success: false, error: '회의실을 찾을 수 없습니다.' });
}

// ─── 초기 설정 (한 번만 실행) ───────────────────────────
function initializeSheet() {
  getSheet();
  getRoomSheet();
  getAuditSheet();
  Logger.log('시트가 초기화되었습니다.');
}
