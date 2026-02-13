/**
 * J동 회의실 예약 시스템 - Google Apps Script 백엔드
 * Google Sheets를 데이터베이스로 사용
 */

// ─── 설정 ───────────────────────────────────────────────
const SHEET_NAME = '예약';
const ROOM_SHEET_NAME = '회의실';
const LEGACY_ADMIN_CODE = '041082'; // 마이그레이션용 fallback (운영 시 Script Property 사용 권장)

const RESERVATION_TOKEN_TTL_SECONDS = 60 * 10; // 10분
const ADMIN_TOKEN_TTL_SECONDS = 60 * 30; // 30분
const TOKEN_PREFIX = 'token:';

const MAX_AUTH_ATTEMPTS = 5;
const AUTH_WINDOW_SECONDS = 60 * 5; // 5분
const AUTH_LOCK_SECONDS = 60 * 15; // 15분

const PROP_ADMIN_CODE = 'ADMIN_CODE';
const PROP_PASSWORD_PEPPER = 'PASSWORD_PEPPER';

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
        return getRooms();
      case 'verifyAdmin':
        return verifyAdmin(params);
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
    results = results.filter(function(r) {
      return String(r['층']) === String(params.floor);
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

  if (!date || !floor || !startTime || !endTime || !teamName || !userName || !password) {
    return jsonResponse({ success: false, error: '모든 필드를 입력해주세요.' });
  }

  if (!/^\d{4}$/.test(password)) {
    return jsonResponse({ success: false, error: '비밀번호는 4자리 숫자여야 합니다.' });
  }

  const conflict = checkTimeConflict(date, floor, startTime, endTime);
  if (conflict) {
    return jsonResponse({ success: false, error: '해당 시간에 이미 예약이 있습니다.' });
  }

  const sheet = getSheet();
  const id = generateId();
  const passwordHash = hashPassword(password);
  const createdAt = new Date().toISOString();

  sheet.appendRow([id, date, floor, startTime, endTime, teamName, userName, passwordHash, createdAt]);

  return jsonResponse({
    success: true,
    data: {
      '예약ID': id,
      '날짜': date,
      '층': floor,
      '시작시간': startTime,
      '종료시간': endTime,
      '팀명': teamName,
      '예약자': userName
    },
    message: '예약이 완료되었습니다.'
  });
}

// ─── 시간 충돌 확인 ─────────────────────────────────────
function checkTimeConflict(date, floor, startTime, endTime, excludeId) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  const targetDate = normalizeDateValue(date);
  const targetFloor = String(floor);
  const targetStart = normalizeTimeValue(startTime);
  const targetEnd = normalizeTimeValue(endTime);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (excludeId && String(row[0]) === String(excludeId)) continue;

    const rowDate = normalizeDateValue(row[1]);
    const rowFloor = String(row[2]);
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
        return jsonResponse({ success: false, error: '비밀번호가 일치하지 않습니다.' });
      }

      clearAuthFailure('reservation', id);
      const token = issueReservationToken(id);
      return jsonResponse({ success: true, token: token, message: '인증 성공' });
    }
  }

  recordAuthFailure('reservation', id);
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

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      const currentDate = normalizeDateValue(rows[i][1]);
      const currentFloor = String(rows[i][2]);
      const currentStart = normalizeTimeValue(rows[i][3]);
      const currentEnd = normalizeTimeValue(rows[i][4]);

      const newDate = date || currentDate;
      const newFloor = floor || currentFloor;
      const newStart = startTime || currentStart;
      const newEnd = endTime || currentEnd;

      const conflict = checkTimeConflict(newDate, newFloor, newStart, newEnd, id);
      if (conflict) {
        return jsonResponse({ success: false, error: '해당 시간에 이미 예약이 있습니다.' });
      }

      const rowIndex = i + 2;
      if (date) sheet.getRange(rowIndex, 2).setValue(date);
      if (floor) sheet.getRange(rowIndex, 3).setValue(floor);
      if (startTime) sheet.getRange(rowIndex, 4).setValue(startTime);
      if (endTime) sheet.getRange(rowIndex, 5).setValue(endTime);
      if (teamName) sheet.getRange(rowIndex, 6).setValue(teamName);
      if (userName) sheet.getRange(rowIndex, 7).setValue(userName);

      // 민감 작업 완료 후 토큰 폐기(재사용 방지)
      deleteToken(token);
      return jsonResponse({ success: true, message: '예약이 수정되었습니다.' });
    }
  }

  return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
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

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const rows = data.slice(1);

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      if (usedReservationToken) {
        deleteToken(token);
      }
      return jsonResponse({ success: true, message: '예약이 삭제되었습니다.' });
    }
  }

  return jsonResponse({ success: false, error: '예약을 찾을 수 없습니다.' });
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
    return jsonResponse({ success: true, token: token, message: '관리자 인증 성공' });
  }

  recordAuthFailure('admin', 'global');
  return jsonResponse({ success: false, error: '관리자 인증에 실패했습니다.' });
}

// ─── 회의실 조회 ────────────────────────────────────────
function getRooms() {
  const sheet = getRoomSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  const results = rows.map(function(row) {
    let obj = {};
    headers.forEach(function(h, i) {
      obj[h] = row[i];
    });
    obj['활성화'] = String(obj['활성화']).toUpperCase() === 'TRUE';
    return obj;
  });

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
      return jsonResponse({ success: true, message: '회의실이 삭제되었습니다.' });
    }
  }

  return jsonResponse({ success: false, error: '회의실을 찾을 수 없습니다.' });
}

// ─── 초기 설정 (한 번만 실행) ───────────────────────────
function initializeSheet() {
  getSheet();
  getRoomSheet();
  Logger.log('시트가 초기화되었습니다.');
}
