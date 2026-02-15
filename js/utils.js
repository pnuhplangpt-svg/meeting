export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeJsSingleQuote(value) {
  return String(value == null ? '' : value)
    .split('\\').join('\\\\')
    .split("'").join("\\'")
    .split('\n').join('\\n')
    .split('\r').join('\\r');
}

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

export function formatDateKr(dateStr) {
  const parts = dateStr.split('-');
  return parseInt(parts[1]) + '월 ' + parseInt(parts[2]) + '일';
}

export function normalizeDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
  } catch (e) { }
  return String(val);
}

export function normalizeTime(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) {
    return val;
  }
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    }
  } catch (e) { }
  return String(val);
}

export function addMinutes(timeStr, minutes) {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]) + minutes;
  const totalMin = h * 60 + m;
  const newH = Math.floor(totalMin / 60);
  const newM = totalMin % 60;
  return String(newH).padStart(2, '0') + ':' + String(newM).padStart(2, '0');
}

export function formatApiError(error, fallbackMessage) {
  var fallback = fallbackMessage || '요청 처리 중 오류가 발생했습니다.';
  if (!error || !error.message) return fallback;

  var message = String(error.message);
  if (message.indexOf('HTTP 401') === 0 || message.indexOf('HTTP 403') === 0) {
    return '인증이 만료되었거나 권한이 없습니다.';
  }
  if (message.indexOf('HTTP 5') === 0) {
    return '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (message.indexOf('HTTP') === 0) {
    return '네트워크 요청에 실패했습니다. 잠시 후 다시 시도해주세요.';
  }
  if (message.indexOf('JSON parse error') === 0) {
    return '서버 응답을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
  return fallback;
}
export function setTodayDate() {
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const str = now.getFullYear() + '년 ' +
    (now.getMonth() + 1) + '월 ' +
    now.getDate() + '일 ' +
    days[now.getDay()] + '요일';
  const el = document.getElementById('todayDate');
  if (el) el.textContent = str;
}
