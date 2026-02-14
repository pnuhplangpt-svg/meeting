// ═══════════════════════════════════════════════════════
// 설정
// ═══════════════════════════════════════════════════════
const API_URL = 'https://script.google.com/macros/s/AKfycbxcFXOn1btraUlwjNkKQq3g-r4fj6x23ezWNorvo0LFWvUL1Jxg6nuj3z-Hwn6SsOTWNw/exec';

// ═══════════════════════════════════════════════════════
// 상태 관리
// ═══════════════════════════════════════════════════════
const state = (function createAppState() {
  const data = {
    selectedFloor: null,
    selectedDate: null,
    selectedStartTime: null,
    selectedEndTime: null,
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    reservations: [],
    currentReservedSlots: [],
    currentTab: 'all',
    pendingAction: null,
    pendingId: null,
    reservationAuthToken: null,
    editReservationId: null,
    editOriginalReservation: null,
    deleteTargetReservation: null
  };

  const api = {};
  Object.keys(data).forEach(function(key) {
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get: function() { return data[key]; },
      set: function(value) { data[key] = value; }
    });
  });

  return api;
})();

function getResponseToken(res) {
  if (!res || typeof res !== 'object') return '';
  if (typeof res.token === 'string' && res.token) return res.token;
  if (res.data && typeof res.data.token === 'string' && res.data.token) return res.data.token;
  return '';
}


function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsSingleQuote(value) {
  return String(value == null ? '' : value)
    .split('\\').join('\\\\')
    .split("'").join("\\'")
    .split('\n').join('\\n')
    .split('\r').join('\\r');
}

function formatApiError(error, fallbackMessage) {
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


function initNetworkBanner() {
  var banner = document.getElementById('offlineBanner');
  if (!banner) return;

  function updateOnlineState() {
    banner.classList.toggle('show', !navigator.onLine);
  }

  updateOnlineState();
  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);
}

// ═══════════════════════════════════════════════════════
// 초기화
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  // 디스플레이 모드 감지 (?display=6F 등)
  if (initDisplayMode()) {
    // 디스플레이 모드: 일반 UI 초기화 건너뜀
    initNetworkBanner();
    registerServiceWorker();
    return;
  }

  // 일반 모드
  bindUiActions();
  setTodayDate();
  initNetworkBanner();
  navigateTo('screenHome');
  initInstallBanner();

  registerServiceWorker();
});



function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  var hasControllerChangeReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (hasControllerChangeReloaded) return;
    hasControllerChangeReloaded = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then(function(registration) {
    function handleInstallingWorker(worker) {
      if (!worker) return;
      worker.addEventListener('statechange', function() {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    }

    handleInstallingWorker(registration.installing);

    registration.addEventListener('updatefound', function() {
      handleInstallingWorker(registration.installing);
    });

    setInterval(function() {
      registration.update().catch(function() {});
    }, 60 * 1000);
  }).catch(function() {});
}

function setTodayDate() {
  const now = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const str = now.getFullYear() + '년 ' +
    (now.getMonth() + 1) + '월 ' +
    now.getDate() + '일 ' +
    days[now.getDay()] + '요일';
  document.getElementById('todayDate').textContent = str;
}


function bindUiActions() {
  var byId = function(id) { return document.getElementById(id); };

  var btnOpenAdminAuth = byId('btnOpenAdminAuth');
  if (btnOpenAdminAuth) btnOpenAdminAuth.addEventListener('click', openAdminAuth);

  var btnDismissInstallBanner = byId('btnDismissInstallBanner');
  if (btnDismissInstallBanner) btnDismissInstallBanner.addEventListener('click', dismissInstallBanner);

  var installBtn = byId('installBtn');
  if (installBtn) installBtn.addEventListener('click', handleInstallClick);

  var btnStartReserve = byId('btnStartReserve');
  if (btnStartReserve) btnStartReserve.addEventListener('click', startReservation);

  var btnConfirmReserve = byId('btnConfirmReserve');
  if (btnConfirmReserve) btnConfirmReserve.addEventListener('click', handleConfirmReservation);

  var btnExitAdminMode = byId('btnExitAdminMode');
  if (btnExitAdminMode) btnExitAdminMode.addEventListener('click', exitAdminMode);

  var btnAdminRefresh = byId('btnAdminRefresh');
  if (btnAdminRefresh) btnAdminRefresh.addEventListener('click', adminRefresh);

  var btnAdminDeletePast = byId('btnAdminDeletePast');
  if (btnAdminDeletePast) btnAdminDeletePast.addEventListener('click', adminDeletePast);

  var btnAdminAddRoom = byId('btnAdminAddRoom');
  if (btnAdminAddRoom) btnAdminAddRoom.addEventListener('click', adminAddRoom);

  var btnVerifyAdminCode = byId('btnVerifyAdminCode');
  if (btnVerifyAdminCode) btnVerifyAdminCode.addEventListener('click', verifyAdminCode);

  var btnDisplayRefresh = byId('btnDisplayRefresh');
  if (btnDisplayRefresh) btnDisplayRefresh.addEventListener('click', loadDisplayData);

  var btnFullscreen = byId('btnFullscreen');
  if (btnFullscreen) btnFullscreen.addEventListener('click', toggleDisplayFullscreen);

  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;

    var action = el.dataset.action;
    if (action === 'go-my-reservations') return navigateTo('screenMyReservations');
    if (action === 'go-home') return navigateTo('screenHome');
    if (action === 'reset-home') return resetAndGoHome();
    if (action === 'close-modal') return closeModal(el.dataset.modalId);
    if (action === 'switch-tab') return switchTab(el);
    if (action === 'switch-admin-tab') return switchAdminTab(el);
    if (action === 'admin-filter') return adminFilter(el);
    if (action === 'select-floor') return selectFloor(el);
    if (action === 'calendar-prev') return changeMonth(-1);
    if (action === 'calendar-next') return changeMonth(1);
    if (action === 'select-date') return selectDate(el.dataset.date);
    if (action === 'select-time') return selectTime(el.dataset.time);
    if (action === 'request-edit') return requestEdit(el.dataset.id);
    if (action === 'request-delete') return requestDelete(el.dataset.id);
    if (action === 'admin-delete-one') return adminDeleteOne(el.dataset.id);
    if (action === 'admin-toggle-room') return adminToggleRoom(el.dataset.roomId, el.dataset.active === 'true');
    if (action === 'admin-remove-room') return adminRemoveRoom(el.dataset.roomId);
  });
}

// ═══════════════════════════════════════════════════════
// 회의실 목록 로드 (메인 화면)
// ═══════════════════════════════════════════════════════
var roomList = [];

async function loadRoomsForHome() {
  var grid = document.getElementById('floorGrid');
  grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>';

  try {
    var res = await apiGet('getRooms', {});
    if (res.success) {
      roomList = (res.data || []).filter(function(r) { return r['활성화'] === true; });
      renderFloorGrid();
    } else {
      // 실패 시 기본 회의실 표시
      roomList = [
        { '회의실ID': '6F', '층': '6F', '이름': '회의실', '활성화': true },
        { '회의실ID': '7F', '층': '7F', '이름': '회의실', '활성화': true },
        { '회의실ID': '8F', '층': '8F', '이름': '회의실', '활성화': true },
        { '회의실ID': '9F', '층': '9F', '이름': '회의실', '활성화': true }
      ];
      renderFloorGrid();
    }
  } catch (e) {
    // 오프라인 시 기본값 사용
    roomList = [
      { '회의실ID': '6F', '층': '6F', '이름': '회의실', '활성화': true },
      { '회의실ID': '7F', '층': '7F', '이름': '회의실', '활성화': true },
      { '회의실ID': '8F', '층': '8F', '이름': '회의실', '활성화': true },
      { '회의실ID': '9F', '층': '9F', '이름': '회의실', '활성화': true }
    ];
    renderFloorGrid();
  }
}

function renderFloorGrid() {
  var grid = document.getElementById('floorGrid');
  if (roomList.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--gray-text);">활성화된 회의실이 없습니다</div>';
    return;
  }

  var html = '';
  roomList.forEach(function(room) {
    html +=
      '<div class="floor-card" data-action="select-floor" data-floor="' + escapeHtml(room['층']) + '">' +
        '<div class="floor-number">' + escapeHtml(room['층']) + '</div>' +
        '<div class="floor-label">' + escapeHtml(room['이름']) + '</div>' +
      '</div>';
  });
  grid.innerHTML = html;
}

// ═══════════════════════════════════════════════════════
// 화면 전환
// ═══════════════════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active', 'visible');
  });
  const target = document.getElementById(id);
  target.classList.add('active');
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      target.classList.add('visible');
    });
  });
  window.scrollTo(0, 0);
}

function navigateTo(screenId) {
  // 화면별 최신 데이터 로드
  if (screenId === 'screenHome') {
    loadRoomsForHome();
  }
  if (screenId === 'screenMyReservations') {
    loadReservations();
  }
  showScreen(screenId);
}

function resetAndGoHome() {
  state.reservationAuthToken = null;
  state.editReservationId = null;
  state.editOriginalReservation = null;
  state.selectedFloor = null;
  state.selectedDate = null;
  state.selectedStartTime = null;
  state.selectedEndTime = null;
  state.deleteTargetReservation = null;

  const btn = document.getElementById('btnStartReserve');
  btn.disabled = true;
  btn.textContent = '층을 선택해주세요';

  setReservationPasswordMode(false);
  document.getElementById('reserveTitle').textContent = '예약하기';
  document.getElementById('reserveSubtitle').textContent = '회의실과 시간을 선택해주세요';

  navigateTo('screenHome');
}

// ═══════════════════════════════════════════════════════
// 층 선택
// ═══════════════════════════════════════════════════════
function selectFloor(el) {
  document.querySelectorAll('.floor-card').forEach(function(c) {
    c.classList.remove('selected');
  });
  el.classList.add('selected');
  state.selectedFloor = el.dataset.floor;

  const btn = document.getElementById('btnStartReserve');
  btn.disabled = false;
  btn.textContent = state.selectedFloor + ' 회의실 예약하기';
}

// ═══════════════════════════════════════════════════════
// 예약 시작
// ═══════════════════════════════════════════════════════
function startReservation() {
  if (!state.selectedFloor) return;

  state.editReservationId = null;
  state.reservationAuthToken = null;
  state.selectedDate = null;
  state.selectedStartTime = null;
  state.selectedEndTime = null;
  state.calendarYear = new Date().getFullYear();
  state.calendarMonth = new Date().getMonth();

  document.getElementById('reserveTitle').textContent = state.selectedFloor + ' 예약하기';
  document.getElementById('reserveSubtitle').textContent = 'J동 ' + state.selectedFloor + ' 회의실';

  document.getElementById('timeSection').style.display = 'none';
  document.getElementById('formDivider').style.display = 'none';
  document.getElementById('formSection').style.display = 'none';

  document.getElementById('inputTeam').value = '';
  document.getElementById('inputName').value = '';
  document.getElementById('inputPassword').value = '';
  setReservationPasswordMode(false);

  updateConfirmButton();
  renderCalendar();
  showScreen('screenReserve');
}

function setReservationPasswordMode(isEditMode) {
  var passwordGroup = document.getElementById('passwordInputGroup');
  var editNotice = document.getElementById('editAuthNotice');
  var inputPassword = document.getElementById('inputPassword');

  if (!passwordGroup || !editNotice || !inputPassword) return;

  if (isEditMode) {
    passwordGroup.style.display = 'none';
    editNotice.style.display = 'block';
    inputPassword.value = '';
  } else {
    passwordGroup.style.display = '';
    editNotice.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════
// 달력 렌더링
// ═══════════════════════════════════════════════════════
function renderCalendar() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월',
    '7월', '8월', '9월', '10월', '11월', '12월'];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = '<div class="calendar-nav">';
  html += '<button data-action="calendar-prev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>';
  html += '<span class="calendar-month">' + year + '년 ' + monthNames[month] + '</span>';
  html += '<button data-action="calendar-next"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>';
  html += '</div>';

  html += '<div class="calendar-weekdays">';
  ['일', '월', '화', '수', '목', '금', '토'].forEach(function(d) {
    html += '<span>' + d + '</span>';
  });
  html += '</div>';

  html += '<div class="calendar-days">';

  // 이전 달
  for (let i = firstDay - 1; i >= 0; i--) {
    html += '<button class="calendar-day disabled other-month">' + (daysInPrevMonth - i) + '</button>';
  }

  // 현재 달
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = formatDate(date);
    let classes = 'calendar-day';

    if (date < today) {
      classes += ' disabled';
    }

    if (date.getTime() === today.getTime()) {
      classes += ' today';
    }

    if (state.selectedDate === dateStr) {
      classes += ' selected';
    }

    html += '<button class="' + classes + '" data-action="select-date" data-date="' + dateStr + '">' + d + '</button>';
  }

  // 다음 달
  const totalCells = firstDay + daysInMonth;
  const remainCells = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= remainCells; i++) {
    html += '<button class="calendar-day disabled other-month">' + i + '</button>';
  }

  html += '</div>';

  document.getElementById('calendar').innerHTML = html;
}

function changeMonth(dir) {
  state.calendarMonth += dir;
  if (state.calendarMonth > 11) {
    state.calendarMonth = 0;
    state.calendarYear++;
  } else if (state.calendarMonth < 0) {
    state.calendarMonth = 11;
    state.calendarYear--;
  }
  renderCalendar();
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function formatDateKr(dateStr) {
  const parts = dateStr.split('-');
  return parseInt(parts[1]) + '월 ' + parseInt(parts[2]) + '일';
}

// Google Sheets에서 Date 객체 또는 다양한 형식으로 반환될 수 있으므로 정규화
function normalizeDate(val) {
  if (!val) return '';
  // 이미 YYYY-MM-DD 형식이면 그대로 반환
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return val;
  }
  // ISO 문자열 (2026-02-12T00:00:00.000Z) 또는 Date 호환 문자열
  try {
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    }
  } catch (e) {}
  return String(val);
}

function normalizeTime(val) {
  if (!val) return '';
  // 이미 HH:MM 형식이면 그대로 반환
  if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) {
    return val;
  }
  // Date 객체 또는 ISO 문자열에서 시간 추출
  try {
    // "Sat Dec 30 1899 09:00:00 GMT+0900" 같은 Google Sheets 시간 형식
    var d = new Date(val);
    if (!isNaN(d.getTime())) {
      return String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    }
  } catch (e) {}
  return String(val);
}

// ═══════════════════════════════════════════════════════
// 날짜 선택
// ═══════════════════════════════════════════════════════
function selectDate(dateStr) {
  state.selectedDate = dateStr;
  state.selectedStartTime = null;
  state.selectedEndTime = null;
  renderCalendar();
  loadTimeSlots();
}

// ═══════════════════════════════════════════════════════
// 시간 슬롯
// ═══════════════════════════════════════════════════════
async function loadTimeSlots() {
  const section = document.getElementById('timeSection');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  document.getElementById('formDivider').style.display = 'none';
  document.getElementById('formSection').style.display = 'none';
  document.getElementById('timeHint').textContent = '시작 시간을 선택하세요';

  let reservedSlots = [];

  showLoading(true);

  try {
    const res = await apiGet('getReservations', {
      date: state.selectedDate,
      floor: state.selectedFloor
    });
    if (res.success) {
      reservedSlots = (res.data || []).map(function(r) {
        r['시작시간'] = normalizeTime(r['시작시간']);
        r['종료시간'] = normalizeTime(r['종료시간']);
        return r;
      });
    }
  } catch (e) {
    // 오프라인 모드: 예약 현황 없이 표시
  }

  showLoading(false);
  if (state.editReservationId) {
    reservedSlots = reservedSlots.filter(function(r) {
      return String(r['예약ID']) !== String(state.editReservationId);
    });
  }
  state.currentReservedSlots = reservedSlots;
  renderTimeGrid(reservedSlots);
  updateConfirmButton();
  if (state.editReservationId && state.selectedEndTime) {
    renderSelectionSummary();
  }
}

function renderTimeGrid(reservedSlots) {
  const grid = document.getElementById('timeGrid');
  let html = '';

  // 표시 범위: 07:00 ~ 21:00 (21:30~06:30은 숨김 처리, 데이터는 유지)
  var SLOT_OPEN = '07:00';
  var SLOT_CLOSE = '21:00';

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      const displayTime = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      let classes = 'time-slot';

      // 운영시간 외 슬롯은 숨김
      var isHidden = (time >= SLOT_CLOSE || time < SLOT_OPEN);
      if (isHidden) {
        classes += ' time-slot-hidden';
      }

      // 예약된 시간 확인
      const isReserved = reservedSlots.some(function(r) {
        return time >= r['시작시간'] && time < r['종료시간'];
      });

      if (isReserved) {
        classes += ' reserved';
      }

      // 선택 상태
      if (state.selectedStartTime && state.selectedEndTime) {
        if (time === state.selectedStartTime || time === addMinutes(state.selectedEndTime, -30)) {
          classes += ' selected';
        } else if (time > state.selectedStartTime && time < state.selectedEndTime) {
          classes += ' in-range';
        }
      } else if (state.selectedStartTime === time) {
        classes += ' selected';
      }

      html += '<button class="' + classes + '" data-action="select-time" data-time="' + time + '">' + displayTime + '</button>';
    }
  }

  grid.innerHTML = html;
}

function addMinutes(timeStr, minutes) {
  const parts = timeStr.split(':');
  const h = parseInt(parts[0]);
  const m = parseInt(parts[1]) + minutes;
  const totalMin = h * 60 + m;
  const newH = Math.floor(totalMin / 60);
  const newM = totalMin % 60;
  return String(newH).padStart(2, '0') + ':' + String(newM).padStart(2, '0');
}

// 선택한 시작~종료 구간 내에 예약된 슬롯이 있는지 확인
function hasConflictInRange(startTime, endTime) {
  var reserved = state.currentReservedSlots || [];
  for (var i = 0; i < reserved.length; i++) {
    var r = reserved[i];
    // 구간이 겹치는지 확인: 선택 시작 < 예약 종료 AND 선택 종료 > 예약 시작
    if (startTime < r['종료시간'] && endTime > r['시작시간']) {
      return true;
    }
  }
  return false;
}

function selectTime(time) {
  const hint = document.getElementById('timeHint');

  if (!state.selectedStartTime) {
    // 첫 번째 클릭: 시작 시간 선택
    state.selectedStartTime = time;
    state.selectedEndTime = null;
    hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
  } else if (!state.selectedEndTime) {
    // 두 번째 클릭: 종료 시간 선택
    if (time < state.selectedStartTime) {
      // 시작시간보다 이전이면 해당 시간을 새 시작시간으로 설정
      state.selectedStartTime = time;
      state.selectedEndTime = null;
      hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
    } else {
      var candidateEnd = addMinutes(time, 30);
      // 선택 구간 내에 이미 예약된 시간이 있는지 확인
      if (hasConflictInRange(state.selectedStartTime, candidateEnd)) {
        showToast('선택한 시간 구간에 이미 예약이 있습니다. 종료 시간을 다시 선택해주세요.', 'error');
        state.selectedEndTime = null;
        hint.textContent = '종료 시간을 다시 선택하세요 (시작: ' + state.selectedStartTime + ')';
      } else {
        state.selectedEndTime = candidateEnd;
        hint.textContent = state.selectedStartTime + ' ~ ' + state.selectedEndTime;
        showFormSection();
      }
    }
  } else {
    // 이미 둘 다 선택됨 → 리셋
    state.selectedStartTime = time;
    state.selectedEndTime = null;
    hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
    document.getElementById('formDivider').style.display = 'none';
    document.getElementById('formSection').style.display = 'none';
  }

  // 그리드 다시 렌더링
  document.querySelectorAll('.time-slot').forEach(function(btn) {
    const t = btn.dataset.time;
    btn.classList.remove('selected', 'in-range');

    if (state.selectedStartTime && state.selectedEndTime) {
      if (t === state.selectedStartTime || t === addMinutes(state.selectedEndTime, -30)) {
        btn.classList.add('selected');
      } else if (t > state.selectedStartTime && t < state.selectedEndTime) {
        btn.classList.add('in-range');
      }
    } else if (state.selectedStartTime === t) {
      btn.classList.add('selected');
    }
  });

  updateConfirmButton();
  if (state.editReservationId && state.selectedEndTime) {
    renderSelectionSummary();
  }
}

function handleConfirmReservation() {
  if (state.editReservationId) {
    return submitUpdate(state.editReservationId);
  }
  return submitReservation();
}

function getEditDiffRows() {
  if (!state.editReservationId || !state.editOriginalReservation) return '';

  var current = {
    floor: state.selectedFloor || '',
    date: state.selectedDate || '',
    startTime: state.selectedStartTime || '',
    endTime: state.selectedEndTime || '',
    teamName: document.getElementById('inputTeam').value.trim(),
    userName: document.getElementById('inputName').value.trim()
  };

  var before = state.editOriginalReservation;
  var rows = [];

  function pushIfChanged(label, from, to) {
    if (String(from || '') === String(to || '')) return;
    rows.push(
      '<div class="edit-change-item">' +
        '<span class="edit-change-label">' + escapeHtml(label) + '</span>' +
        '<span class="edit-change-arrow">' + escapeHtml(String(from || '미입력')) + ' → ' + escapeHtml(String(to || '미입력')) + '</span>' +
      '</div>'
    );
  }

  pushIfChanged('층', before.floor, current.floor);
  pushIfChanged('날짜', before.date, current.date);
  pushIfChanged('시간', (before.startTime || '') + ' ~ ' + (before.endTime || ''), (current.startTime || '') + ' ~ ' + (current.endTime || ''));
  pushIfChanged('팀명', before.teamName, current.teamName);
  pushIfChanged('예약자', before.userName, current.userName);

  if (rows.length === 0) return '<div class="edit-change-empty">변경된 내용이 없습니다.</div>';
  return '<div class="edit-change-title">변경 예정 항목</div>' + rows.join('');
}

function renderSelectionSummary() {
  const summary = document.getElementById('selectionSummary');
  if (!summary) return;

  summary.innerHTML =
    '<div class="sel-item"><span class="sel-label">층</span><span class="sel-value">' + state.selectedFloor + '</span></div>' +
    '<div class="sel-item"><span class="sel-label">날짜</span><span class="sel-value">' + formatDateKr(state.selectedDate) + '</span></div>' +
    '<div class="sel-item"><span class="sel-label">시간</span><span class="sel-value">' + state.selectedStartTime + ' ~ ' + state.selectedEndTime + '</span></div>' +
    (state.editReservationId ? '<div class="edit-change-box">' + getEditDiffRows() + '</div>' : '');
}

function showFormSection() {
  document.getElementById('formDivider').style.display = 'block';
  const section = document.getElementById('formSection');
  section.style.display = 'block';

  renderSelectionSummary();

  setTimeout(function() {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ═══════════════════════════════════════════════════════
// 예약 제출
// ═══════════════════════════════════════════════════════
function updateConfirmButton() {
  const btn = document.getElementById('btnConfirmReserve');
  const team = document.getElementById('inputTeam').value.trim();
  const name = document.getElementById('inputName').value.trim();
  const pw = document.getElementById('inputPassword').value.trim();

  const isValid = state.selectedDate &&
    state.selectedStartTime &&
    state.selectedEndTime &&
    team.length > 0 &&
    name.length > 0 &&
    (state.editReservationId ? true : /^\d{4}$/.test(pw));

  btn.disabled = !isValid;
  if (state.editReservationId) {
    btn.textContent = isValid ? '예약 수정' : '모든 정보를 입력해주세요';
  } else {
    btn.textContent = isValid ? '예약 완료' : '모든 정보를 입력해주세요';
  }
}

// 입력 필드 이벤트 리스너
document.addEventListener('input', function(e) {
  if (['inputTeam', 'inputName', 'inputPassword'].includes(e.target.id)) {
    updateConfirmButton();
    if (state.editReservationId) {
      renderSelectionSummary();
    }
  }
});

async function submitReservation() {
  const btn = document.getElementById('btnConfirmReserve');
  if (btn.disabled) return;

  showLoading(true);

  try {
    const res = await apiPost({
      action: 'createReservation',
      date: state.selectedDate,
      floor: state.selectedFloor,
      startTime: state.selectedStartTime,
      endTime: state.selectedEndTime,
      teamName: document.getElementById('inputTeam').value.trim(),
      userName: document.getElementById('inputName').value.trim(),
      password: document.getElementById('inputPassword').value.trim()
    });

    showLoading(false);

    if (res.success) {
      showCompleteScreen(res.data);
      showToast('예약이 완료되었습니다!', 'success');
    } else {
      showToast(res.error || '예약에 실패했습니다.', 'error');
    }
  } catch (e) {
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

function showCompleteScreen(data) {
  const card = document.getElementById('completeCard');
  card.innerHTML =
    '<div class="card-header">' +
      '<span class="card-floor">' + escapeHtml(data['층']) + '</span>' +
      '<span class="card-time">' + escapeHtml(data['시작시간']) + ' ~ ' + escapeHtml(data['종료시간']) + '</span>' +
    '</div>' +
    '<div class="card-info">' +
      '<div class="card-row"><span class="label">날짜</span><span class="value">' + formatDateKr(data['날짜']) + '</span></div>' +
      '<div class="card-row"><span class="label">팀명</span><span class="value">' + escapeHtml(data['팀명']) + '</span></div>' +
      '<div class="card-row"><span class="label">예약자</span><span class="value">' + escapeHtml(data['예약자']) + '</span></div>' +
    '</div>';

  showScreen('screenComplete');
}

// ═══════════════════════════════════════════════════════
// 예약 내역 조회
// ═══════════════════════════════════════════════════════
async function loadReservations() {
  const list = document.getElementById('reservationsList');
  list.innerHTML = '<div style="text-align:center; padding:40px 0;"><div class="spinner" style="margin:0 auto;"></div></div>';

  try {
    const res = await apiGet('getReservations', {});

    if (res.success) {
      // 날짜/시간 데이터 정규화 (Google Sheets가 Date 객체로 반환할 수 있음)
      state.reservations = (res.data || []).map(function(r) {
        r['날짜'] = normalizeDate(r['날짜']);
        r['시작시간'] = normalizeTime(r['시작시간']);
        r['종료시간'] = normalizeTime(r['종료시간']);
        return r;
      }).sort(function(a, b) {
        if (a['날짜'] !== b['날짜']) return a['날짜'] > b['날짜'] ? 1 : -1;
        return a['시작시간'] > b['시작시간'] ? 1 : -1;
      });
      renderReservations();
    } else {
      list.innerHTML = '<div class="empty-state"><p>데이터를 불러올 수 없습니다.</p></div>';
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(formatApiError(e, '서버에 연결할 수 없습니다.')) + '</p></div>';
  }
}

function renderReservations() {
  const list = document.getElementById('reservationsList');
  let filtered = state.reservations;

  if (state.currentTab !== 'all') {
    filtered = filtered.filter(function(r) {
      return r['층'] === state.currentTab;
    });
  }

  // 오늘 이후만 표시
  const today = formatDate(new Date());
  filtered = filtered.filter(function(r) {
    return r['날짜'] >= today;
  });

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        '<p>예약된 회의실이 없습니다</p>' +
      '</div>';
    return;
  }

  // 날짜별 그룹핑
  const grouped = {};
  filtered.forEach(function(r) {
    if (!grouped[r['날짜']]) grouped[r['날짜']] = [];
    grouped[r['날짜']].push(r);
  });

  let html = '';
  Object.keys(grouped).sort().forEach(function(date) {
    html += '<div class="date-badge">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
      formatDateKr(date) +
    '</div>';

    grouped[date].forEach(function(r) {
      html +=
        '<div class="reservation-card fade-in">' +
          '<div class="card-header">' +
            '<span class="card-floor">' + escapeHtml(r['층']) + '</span>' +
            '<span class="card-time">' + escapeHtml(r['시작시간']) + ' ~ ' + escapeHtml(r['종료시간']) + '</span>' +
          '</div>' +
          '<div class="card-info">' +
            '<div class="card-row"><span class="label">팀명</span><span class="value">' + escapeHtml(r['팀명']) + '</span></div>' +
            '<div class="card-row"><span class="label">예약자</span><span class="value">' + escapeHtml(r['예약자']) + '</span></div>' +
          '</div>' +
          '<div class="card-actions">' +
            '<button class="btn btn-outline" style="flex:1" data-action="request-edit" data-id="' + escapeHtml(r['예약ID']) + '">수정</button>' +
            '<button class="btn btn-outline-red" style="flex:1" data-action="request-delete" data-id="' + escapeHtml(r['예약ID']) + '">삭제</button>' +
          '</div>' +
        '</div>';
    });
  });

  list.innerHTML = html;
}

function switchTab(el) {
  document.querySelectorAll('.tab-item').forEach(function(t) {
    t.classList.remove('active');
  });
  el.classList.add('active');
  state.currentTab = el.dataset.tab;
  renderReservations();
}

// ═══════════════════════════════════════════════════════
// 수정 / 삭제
// ═══════════════════════════════════════════════════════
function requestEdit(id) {
  state.reservationAuthToken = null;
  state.pendingAction = 'edit';
  state.pendingId = id;
  document.getElementById('modalPasswordInput').value = '';
  openModal('modalPassword');

  document.getElementById('modalPasswordConfirm').onclick = function() {
    verifyAndEdit(id);
  };
}

function requestDelete(id) {
  state.reservationAuthToken = null;
  state.pendingAction = 'delete';
  state.pendingId = id;
  state.deleteTargetReservation = null;
  document.getElementById('modalPasswordInput').value = '';
  openModal('modalPassword');

  document.getElementById('modalPasswordConfirm').onclick = function() {
    verifyAndDelete(id);
  };
}

async function verifyAndEdit(id) {
  const pw = document.getElementById('modalPasswordInput').value.trim();
  if (!pw) {
    showToast('비밀번호를 입력하세요.', 'error');
    return;
  }

  showLoading(true);
  closeModal('modalPassword');

  try {
    const res = await apiPost({
      action: 'verifyPassword',
      id: id,
      password: pw
    });

    showLoading(false);

    if (res.success) {
      state.reservationAuthToken = getResponseToken(res);
      if (!state.reservationAuthToken) {
        state.reservationAuthToken = null;
        showToast('서버가 토큰 인증을 지원하지 않습니다.', 'error');
        return;
      }
      // 해당 예약 정보로 예약 화면 열기
      const reservation = state.reservations.find(function(r) {
        return r['예약ID'] === id;
      });

      if (reservation) {
        state.editReservationId = id;
        state.selectedFloor = reservation['층'];
        state.selectedDate = reservation['날짜'];
        state.selectedStartTime = reservation['시작시간'];
        state.selectedEndTime = reservation['종료시간'];
        state.editOriginalReservation = {
          floor: reservation['층'],
          date: reservation['날짜'],
          startTime: reservation['시작시간'],
          endTime: reservation['종료시간'],
          teamName: reservation['팀명'],
          userName: reservation['예약자']
        };

        document.getElementById('reserveTitle').textContent = '예약 수정';
        document.getElementById('reserveSubtitle').textContent = 'J동 ' + reservation['층'] + '회의실';
        document.getElementById('inputTeam').value = reservation['팀명'];
        document.getElementById('inputName').value = reservation['예약자'];
        document.getElementById('inputPassword').value = '';
        setReservationPasswordMode(true);

        renderCalendar();
        await loadTimeSlots();
        showFormSection();
        updateConfirmButton();
        showScreen('screenReserve');

        // 제출 버튼 레이블 갱신
        updateConfirmButton();
      }
    } else {
      state.reservationAuthToken = null;
      showToast(res.error || '인증에 실패했습니다.', 'error');
    }
  } catch (e) {
    state.reservationAuthToken = null;
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

async function submitUpdate(id) {
  if (state.editOriginalReservation && !getEditDiffRows().includes('edit-change-item')) {
    showToast('변경된 내용이 없습니다.', 'error');
    return;
  }

  showLoading(true);

  try {
    const res = await apiPost({
      action: 'updateReservation',
      id: id,
      token: state.reservationAuthToken,
      date: state.selectedDate,
      floor: state.selectedFloor,
      startTime: state.selectedStartTime,
      endTime: state.selectedEndTime,
      teamName: document.getElementById('inputTeam').value.trim(),
      userName: document.getElementById('inputName').value.trim()
    });

    showLoading(false);

    if (res.success) {
      state.reservationAuthToken = null;
      state.editReservationId = null;
      state.editOriginalReservation = null;
      setReservationPasswordMode(false);
      showToast('예약이 수정되었습니다.', 'success');
      await loadReservations();
      showScreen('screenMyReservations');
    } else {
      showToast(res.error || '수정에 실패했습니다.', 'error');
    }
  } catch (e) {
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

function renderDeleteSummary() {
  var box = document.getElementById('modalDeleteSummary');
  if (!box) return;

  var r = state.deleteTargetReservation;
  if (!r) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML =
    '<div class="delete-summary-row"><span class="k">층</span><span class="v">' + escapeHtml(String(r['층'] || '')) + '</span></div>' +
    '<div class="delete-summary-row"><span class="k">날짜</span><span class="v">' + escapeHtml(formatDateKr(String(r['날짜'] || ''))) + '</span></div>' +
    '<div class="delete-summary-row"><span class="k">시간</span><span class="v">' + escapeHtml(String(r['시작시간'] || '') + ' ~ ' + String(r['종료시간'] || '')) + '</span></div>' +
    '<div class="delete-summary-row"><span class="k">팀명</span><span class="v">' + escapeHtml(String(r['팀명'] || '')) + '</span></div>' +
    '<div class="delete-summary-row"><span class="k">예약자</span><span class="v">' + escapeHtml(String(r['예약자'] || '')) + '</span></div>';
}

function clearDeleteSummary() {
  state.deleteTargetReservation = null;
  var box = document.getElementById('modalDeleteSummary');
  if (box) box.innerHTML = '';
}

async function verifyAndDelete(id) {
  const pw = document.getElementById('modalPasswordInput').value.trim();
  if (!pw) {
    showToast('비밀번호를 입력하세요.', 'error');
    return;
  }

  showLoading(true);
  closeModal('modalPassword');

  try {
    const verifyRes = await apiPost({
      action: 'verifyPassword',
      id: id,
      password: pw
    });

    showLoading(false);

    if (!verifyRes.success) {
      showToast(verifyRes.error || '인증에 실패했습니다.', 'error');
      return;
    }

    var token = getResponseToken(verifyRes);
    if (!token) {
      showToast('서버가 토큰 인증을 지원하지 않습니다.', 'error');
      return;
    }

    state.deleteTargetReservation = state.reservations.find(function(r) {
      return r['예약ID'] === id;
    }) || null;
    renderDeleteSummary();

    // 삭제 확인 모달
    openModal('modalDelete');
    document.getElementById('modalDeleteConfirm').onclick = async function() {
      closeModal('modalDelete');
      showLoading(true);

      try {
        const res = await apiPost({
          action: 'deleteReservation',
          id: id,
          token: token
        });

        showLoading(false);

        if (res.success) {
          showToast('예약이 삭제되었습니다.', 'success');
          await loadReservations();
          renderReservations();
        } else {
          showToast(res.error || '삭제에 실패했습니다.', 'error');
        }
      } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
      } finally {
        clearDeleteSummary();
      }
    };
  } catch (e) {
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

// ═══════════════════════════════════════════════════════
// 모달
// ═══════════════════════════════════════════════════════
function openModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  overlay.classList.remove('show');
  document.body.style.overflow = '';
  if (id === 'modalDelete') {
    clearDeleteSummary();
  }
}

// 모달 바깥 클릭 시 닫기
document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      overlay.classList.remove('show');
      document.body.style.overflow = '';
    }
  });
});

// ═══════════════════════════════════════════════════════
// 토스트 메시지
// ═══════════════════════════════════════════════════════
function showToast(message, type) {
  type = type || '';
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(function() {
    toast.classList.add('show');
  });

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() {
      container.removeChild(toast);
    }, 300);
  }, 2500);
}

// ═══════════════════════════════════════════════════════
// 로딩
// ═══════════════════════════════════════════════════════
function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (show) {
    overlay.classList.add('show');
  } else {
    overlay.classList.remove('show');
  }
}

// ═══════════════════════════════════════════════════════
// API 통신
// ═══════════════════════════════════════════════════════
var API_TIMEOUT_MS = 10000;

async function fetchWithTimeoutAndRetry(url, options, retries) {
  var attempts = retries == null ? 0 : retries;
  var lastError = null;

  for (var i = 0; i <= attempts; i++) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, API_TIMEOUT_MS);

    try {
      var response = await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
      clearTimeout(timer);

      if (response.status >= 500 && i < attempts) {
        continue;
      }
      return response;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (i >= attempts) {
        throw e;
      }
    }
  }

  throw lastError || new Error('Network request failed');
}
async function apiGet(action, params) {
  let url = API_URL + '?action=' + encodeURIComponent(action);
  Object.keys(params).forEach(function(key) {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
      url += '&' + encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }
  });

  const response = await fetchWithTimeoutAndRetry(url, { redirect: 'follow' }, 1);
  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' (' + action + ')');
  }

  let payload;
  try {
    payload = await response.json();
  } catch (e) {
    throw new Error('JSON parse error (' + action + ')');
  }
  return payload;
}

async function apiPost(body) {
  const action = body && body.action ? body.action : 'unknown';
  const response = await fetchWithTimeoutAndRetry(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' (' + action + ')');
  }

  let payload;
  try {
    payload = await response.json();
  } catch (e) {
    throw new Error('JSON parse error (' + action + ')');
  }
  return payload;
}

// ═══════════════════════════════════════════════════════
// 디스플레이 모드 (입구 패드용)
// ═══════════════════════════════════════════════════════
var displayFloor = null;
var displayTimer = null;
var displayClockTimer = null;
var displayWakeLock = null;
var DISPLAY_REFRESH_INTERVAL = 60000; // 60초마다 서버 데이터 갱신
var displayRoomNameCache = null;
var displayRoomNameCacheAt = 0;
var DISPLAY_ROOMS_CACHE_TTL = 10 * 60 * 1000; // 10분

function initDisplayMode() {
  var params = new URLSearchParams(window.location.search);
  var floor = params.get('display');
  if (!floor) return false;

  displayFloor = floor;

  // 모든 일반 화면 숨기기
  document.querySelectorAll('.screen').forEach(function(s) {
    s.classList.remove('active', 'visible');
  });

  // 디스플레이 화면 표시
  var screen = document.getElementById('screenDisplay');
  screen.classList.add('active');

  // 층 이름 설정
  document.getElementById('displayFloorName').textContent = floor;

  // 날짜 설정
  updateDisplayDate();

  // 시계 시작 (매초)
  updateDisplayClock();
  displayClockTimer = setInterval(updateDisplayClock, 1000);

  // 첫 데이터 로드
  loadDisplayData();

  // 주기적 데이터 갱신 (60초)
  displayTimer = setInterval(loadDisplayData, DISPLAY_REFRESH_INTERVAL);

  // 화면 꺼짐 방지
  requestWakeLock();

  // 전체화면 진입 안내 오버레이 (비 fullscreen 상태일 때만)
  showFullscreenOverlay();

  // 전체화면 상태 변경 감지 → 아이콘 토글
  document.addEventListener('fullscreenchange', updateFullscreenIcon);

  // 탭 비활성→활성 복귀 시 즉시 갱신 + Wake Lock 재요청
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && displayFloor) {
      loadDisplayData();
      requestWakeLock();
    }
  });

  return true;
}

function updateDisplayDate() {
  var now = new Date();
  var days = ['일', '월', '화', '수', '목', '금', '토'];
  var str = now.getFullYear() + '.' +
    String(now.getMonth() + 1).padStart(2, '0') + '.' +
    String(now.getDate()).padStart(2, '0') + ' (' +
    days[now.getDay()] + ')';
  document.getElementById('displayDate').textContent = str;
}

function updateDisplayClock() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, '0');
  var m = String(now.getMinutes()).padStart(2, '0');
  var s = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('displayClock').textContent = h + ':' + m + ':' + s;

  // 자정 넘으면 날짜 갱신
  if (h === '00' && m === '00' && s === '00') {
    updateDisplayDate();
  }
}

async function loadDisplayData() {
  var today = formatDate(new Date());

  try {
    var res = await apiGet('getReservations', {
      date: today,
      floor: displayFloor
    });

    // 층 이름 캐시(10분 TTL)
    try {
      var nowTs = Date.now();
      if (!displayRoomNameCache || (nowTs - displayRoomNameCacheAt) > DISPLAY_ROOMS_CACHE_TTL) {
        var roomRes = await apiGet('getRooms', {});
        if (roomRes.success) {
          displayRoomNameCache = roomRes.data || [];
          displayRoomNameCacheAt = nowTs;
        }
      }
      if (displayRoomNameCache) {
        var room = displayRoomNameCache.find(function(r) {
          return r['층'] === displayFloor;
        });
        if (room) {
          document.getElementById('displayFloorName').textContent =
            room['층'] + ' ' + room['이름'];
        }
      }
    } catch (e) {}

    if (res.success) {
      var reservations = (res.data || []).map(function(r) {
        r['시작시간'] = normalizeTime(r['시작시간']);
        r['종료시간'] = normalizeTime(r['종료시간']);
        return r;
      }).sort(function(a, b) {
        return a['시작시간'] < b['시작시간'] ? -1 : 1;
      });

      renderDisplayStatus(reservations);
      renderDisplaySchedule(reservations);
    }

    // 갱신 시각 표시
    var now = new Date();
    document.getElementById('displayRefreshInfo').textContent =
      '마지막 갱신 ' + String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0') + ':' +
      String(now.getSeconds()).padStart(2, '0') +
      ' · 자동 갱신 ' + (DISPLAY_REFRESH_INTERVAL / 1000) + '초';

  } catch (e) {
    document.getElementById('displayRefreshInfo').textContent = '서버 연결 실패 · 재시도 중...';
  }
}

function renderDisplayStatus(reservations) {
  var container = document.getElementById('displayStatus');
  var now = new Date();
  var currentTime = String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');

  // 현재 진행 중인 회의 찾기
  var current = null;
  for (var i = 0; i < reservations.length; i++) {
    if (currentTime >= reservations[i]['시작시간'] && currentTime < reservations[i]['종료시간']) {
      current = reservations[i];
      break;
    }
  }

  // 다음 예약 찾기
  var next = null;
  for (var j = 0; j < reservations.length; j++) {
    if (reservations[j]['시작시간'] > currentTime) {
      next = reservations[j];
      break;
    }
  }

  // 상태 클래스 설정
  container.className = 'display-panel-status';

  var html = '';

  if (current) {
    container.classList.add('state-inuse');

    html +=
      '<span class="dp-state-badge inuse">● 사용 중</span>' +
      '<div class="dp-time-range">' + escapeHtml(current['시작시간']) + ' ~ ' + escapeHtml(current['종료시간']) + '</div>' +
      '<div class="dp-state-text inuse">사용 중</div>' +
      '<div class="dp-meeting-info">' +
        '<div class="dp-meeting-team">' + escapeHtml(current['팀명']) + '</div>' +
        '<div class="dp-meeting-user">' + escapeHtml(current['예약자']) + '</div>' +
      '</div>';

    if (next) {
      html += '<div class="dp-next">다음: <strong>' +
        escapeHtml(next['시작시간']) + '</strong> ' + escapeHtml(next['팀명']) + '</div>';
    }
  } else if (next) {
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var nextParts = next['시작시간'].split(':');
    var nextMin = parseInt(nextParts[0]) * 60 + parseInt(nextParts[1]);
    var diffMin = nextMin - nowMin;

    if (diffMin <= 30 && diffMin > 0) {
      container.classList.add('state-soon');
      html +=
        '<span class="dp-state-badge soon">● 곧 시작</span>' +
        '<div class="dp-state-text" style="color:#f5a623;">곧 시작</div>' +
        '<div class="dp-meeting-info">' +
          '<div class="dp-meeting-team">' + escapeHtml(next['팀명']) + '</div>' +
          '<div class="dp-meeting-user">' + escapeHtml(next['예약자']) + '</div>' +
          '<div class="dp-meeting-time">' + escapeHtml(next['시작시간']) + ' ~ ' + escapeHtml(next['종료시간']) +
            ' (' + diffMin + '분 후)</div>' +
        '</div>';
    } else {
      container.classList.add('state-available');

      var diffStr = '';
      if (diffMin >= 60) {
        diffStr = Math.floor(diffMin / 60) + '시간 ' + (diffMin % 60) + '분 후';
      } else {
        diffStr = diffMin + '분 후';
      }

      html +=
        '<span class="dp-state-badge available">● 사용 가능</span>' +
        '<div class="dp-state-text available">사용 가능</div>' +
        '<div class="dp-next" style="margin-top:16px;">' +
          '다음 예약: <strong>' + escapeHtml(next['시작시간']) + ' ~ ' + escapeHtml(next['종료시간']) + '</strong><br>' +
          escapeHtml(next['팀명']) + ' · ' + escapeHtml(diffStr) +
        '</div>';
    }
  } else {
    container.classList.add('state-available');
    html +=
      '<span class="dp-state-badge available">● 사용 가능</span>' +
      '<div class="dp-state-text available">사용 가능</div>' +
      '<div class="dp-next" style="margin-top:16px;">오늘 남은 예약이 없습니다</div>';
  }

  // QR 코드 영역 추가 (예약 앱 바로가기)
  var qrUrl = window.location.origin + window.location.pathname.replace(/\?.*$/, '');

  html +=
    '<div class="dp-qr-area">' +
      '<div id="dpQrCode" class="dp-qr-img"></div>' +
      '<div class="dp-qr-text">QR 스캔하여 예약하기</div>' +
    '</div>';

  container.innerHTML = html;

  // ✅ QR 생성 (외부 API 호출 없음)
  var qrEl = document.getElementById('dpQrCode');
  if (qrEl && window.QRCode) {
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: qrUrl,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.M
    });
  } else {
    if (qrEl) qrEl.textContent = 'QR 라이브러리를 불러오지 못했습니다.';
  }
}


function parseTimeToMinutes(timeStr) {
  if (!timeStr || timeStr.indexOf(':') === -1) return 0;
  var parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function formatMinutesToTime(min) {
  var normalized = ((min % 1440) + 1440) % 1440;
  var h = Math.floor(normalized / 60);
  var m = normalized % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function ceilToHour(min) {
  return Math.ceil(min / 60) * 60;
}

function calculateTimelineHeight(durationMin) {
  var basePerHour = 48;
  return Math.max(48, Math.round((durationMin / 60) * basePerHour));
}

function scrollToCurrentTime(container) {
  if (!container) return;
  var nowRow = container.querySelector('.ds-row.now');
  if (!nowRow) return;
  var target = nowRow.offsetTop - (container.clientHeight * 0.35);
  container.scrollTop = Math.max(0, target);
}

function renderDisplaySchedule(reservations) {
  var container = document.getElementById('displayTimeline');
  if (!container) return;

  var OPEN_MIN = 7 * 60;
  var CLOSE_MIN = 21 * 60;

  var now = new Date();
  var nowMin = now.getHours() * 60 + now.getMinutes();

  var sortedReservations = (reservations || []).slice().sort(function(a, b) {
    return parseTimeToMinutes(a['시작시간']) - parseTimeToMinutes(b['시작시간']);
  });

  var html = '';
  var cursor = OPEN_MIN;

  for (var i = 0; i < sortedReservations.length; i++) {
    var r = sortedReservations[i];
    var rawStart = parseTimeToMinutes(r['시작시간']);
    var rawEnd = parseTimeToMinutes(r['종료시간']);

    var startMin = Math.max(OPEN_MIN, Math.min(CLOSE_MIN, rawStart));
    var endMin = Math.max(OPEN_MIN, Math.min(CLOSE_MIN, rawEnd));

    if (endMin <= startMin) continue;

    while (cursor < startMin) {
      var emptyEnd = Math.min(startMin, ceilToHour(cursor));
      if (emptyEnd <= cursor) emptyEnd = Math.min(startMin, cursor + 60);
      var emptyNow = nowMin >= cursor && nowMin < emptyEnd;
      html += '<div class="ds-row empty' + (emptyNow ? ' now' : '') + '" style="min-height:' +
        calculateTimelineHeight(emptyEnd - cursor) + 'px">' +
          '<div class="ds-row-time">' + formatMinutesToTime(cursor) + '</div>' +
          '<div class="ds-row-content"></div>' +
        '</div>';
      cursor = emptyEnd;
    }

    var isNow = nowMin >= startMin && nowMin < endMin;
    var isPast = nowMin >= endMin;
    var cardClass = 'ds-card';
    if (isNow) cardClass += ' active';
    else if (isPast) cardClass += ' past';

    html += '<div class="ds-row' + (isNow ? ' now' : '') + '" style="min-height:' +
      calculateTimelineHeight(endMin - startMin) + 'px">' +
        '<div class="ds-row-time">' + formatMinutesToTime(startMin) + '</div>' +
        '<div class="ds-row-content">' +
          '<div class="' + cardClass + '">' +
            '<div class="ds-card-team">' +
              escapeHtml(r['팀명']) +
              (isNow ? '<span class="ds-card-badge">진행 중</span>' : '') +
            '</div>' +
            '<div class="ds-card-detail">' +
              escapeHtml(r['예약자']) + ' · ' + formatMinutesToTime(startMin) + ' ~ ' + formatMinutesToTime(endMin) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    cursor = endMin;
  }

  while (cursor < CLOSE_MIN) {
    var nextHour = Math.min(CLOSE_MIN, cursor + 60);
    var tailNow = nowMin >= cursor && nowMin < nextHour;
    html += '<div class="ds-row empty' + (tailNow ? ' now' : '') + '" style="min-height:' +
      calculateTimelineHeight(nextHour - cursor) + 'px">' +
        '<div class="ds-row-time">' + formatMinutesToTime(cursor) + '</div>' +
        '<div class="ds-row-content"></div>' +
      '</div>';
    cursor = nextHour;
  }

  container.innerHTML = html;
  scrollToCurrentTime(container);
}


// 화면 꺼짐 방지 (Wake Lock API)
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    displayWakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    // Wake Lock 실패 시 무시 (권한 거부 등)
  }
}

// 전체화면 토글
function toggleDisplayFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function() {});
  } else {
    document.exitFullscreen().catch(function() {});
  }
}

// 전체화면 아이콘 업데이트
function updateFullscreenIcon() {
  var expand = document.getElementById('iconExpand');
  var shrink = document.getElementById('iconShrink');
  if (!expand || !shrink) return;

  if (document.fullscreenElement) {
    expand.style.display = 'none';
    shrink.style.display = 'block';
  } else {
    expand.style.display = 'block';
    shrink.style.display = 'none';
  }
}

// 처음 진입 시 전체화면 안내 오버레이
function showFullscreenOverlay() {
  // 이미 전체화면이거나 standalone PWA이면 표시하지 않음
  if (document.fullscreenElement) return;
  if (window.matchMedia('(display-mode: fullscreen)').matches) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  var overlay = document.createElement('div');
  overlay.className = 'display-fs-overlay';
  overlay.innerHTML =
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
    '<div class="fs-text">화면을 터치하면 전체화면으로 전환됩니다</div>' +
    '<div class="fs-sub">헤더의 버튼으로 언제든 전환할 수 있습니다</div>';

  overlay.addEventListener('click', function() {
    document.documentElement.requestFullscreen().catch(function() {});
    overlay.remove();
  });

  // 5초 후 자동 사라짐 (터치 안 해도)
  setTimeout(function() {
    if (overlay.parentNode) {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.5s';
      setTimeout(function() { overlay.remove(); }, 500);
    }
  }, 5000);

  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════
// 관리자 모드
// ═══════════════════════════════════════════════════════
var adminMode = false;
var adminAuthToken = '';
var adminReservations = [];
var adminCurrentFilter = 'all';
var adminSecurityAlerts = null;

function openAdminAuth() {
  document.getElementById('adminCodeInput').value = '';
  openModal('modalAdminAuth');
}

async function verifyAdminCode() {
  var code = document.getElementById('adminCodeInput').value.trim();
  if (!code) {
    showToast('관리자 코드를 입력하세요.', 'error');
    return;
  }

  if (!/^\d{6}$/.test(code)) {
    showToast('숫자 6자리를 입력하세요.', 'error');
    return;
  }

  showLoading(true);
  closeModal('modalAdminAuth');

  try {
    var res = await apiGet('verifyAdmin', { code: code });
    showLoading(false);

    if (res.success) {
      adminAuthToken = getResponseToken(res);
      if (!adminAuthToken) {
        showToast('서버가 관리자 토큰 인증을 지원하지 않습니다.', 'error');
        return;
      }
      adminMode = true;
      enterAdminMode();
    } else {
      adminAuthToken = '';
      showToast(res.error || '관리자 인증에 실패했습니다.', 'error');
    }
  } catch (e) {
    adminAuthToken = '';
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

function enterAdminMode() {
  showScreen('screenAdmin');
  // 예약 관리 탭을 기본으로 표시
  document.getElementById('adminTabReservations').style.display = '';
  document.getElementById('adminTabRooms').style.display = 'none';
  document.querySelectorAll('#screenAdmin .tab-item').forEach(function(t, i) {
    t.classList.toggle('active', i === 0);
  });
  adminRefresh();
}

function switchAdminTab(el) {
  document.querySelectorAll('#screenAdmin .tab-item').forEach(function(t) {
    t.classList.remove('active');
  });
  el.classList.add('active');

  var tab = el.dataset.admintab;
  document.getElementById('adminTabReservations').style.display = tab === 'reservations' ? '' : 'none';
  document.getElementById('adminTabRooms').style.display = tab === 'rooms' ? '' : 'none';

  if (tab === 'rooms') {
    loadAdminRooms();
  }
}

function exitAdminMode() {
  adminMode = false;
  adminAuthToken = '';
  adminReservations = [];
  navigateTo('screenHome');
}

async function adminRefresh() {
  showLoading(true);
  var list = document.getElementById('adminReservationsList');
  list.innerHTML = '';

  try {
    var res = await apiGet('getReservations', {});
    showLoading(false);

    if (res.success) {
      adminReservations = (res.data || []).map(function(r) {
        r['날짜'] = normalizeDate(r['날짜']);
        r['시작시간'] = normalizeTime(r['시작시간']);
        r['종료시간'] = normalizeTime(r['종료시간']);
        return r;
      }).sort(function(a, b) {
        if (a['날짜'] !== b['날짜']) return a['날짜'] < b['날짜'] ? -1 : 1;
        return a['시작시간'] < b['시작시간'] ? -1 : 1;
      });

      await loadAdminSecurityAlerts();
      renderAdminStats();
      renderAdminList();
    } else {
      list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(res.error || '데이터를 불러올 수 없습니다.') + '</p></div>';
    }
  } catch (e) {
    showLoading(false);
    list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(formatApiError(e, '서버에 연결할 수 없습니다.')) + '</p></div>';
  }
}



async function loadAdminSecurityAlerts() {
  if (!adminAuthToken) {
    adminSecurityAlerts = null;
    return;
  }

  try {
    var alertRes = await apiGet('getSecurityAlerts', { adminToken: adminAuthToken });
    if (alertRes.success) {
      adminSecurityAlerts = alertRes.data || null;
    } else {
      adminSecurityAlerts = null;
    }
  } catch (e) {
    adminSecurityAlerts = null;
  }
}

function renderAdminStats() {
  var today = formatDate(new Date());
  var total = adminReservations.length;
  var todayCount = adminReservations.filter(function(r) { return r['날짜'] === today; }).length;
  var upcoming = adminReservations.filter(function(r) { return r['날짜'] >= today; }).length;
  var past = adminReservations.filter(function(r) { return r['날짜'] < today; }).length;

  var html =
    '<div class="admin-stat-card"><div class="stat-num">' + total + '</div><div class="stat-label">전체 예약</div></div>' +
    '<div class="admin-stat-card"><div class="stat-num">' + todayCount + '</div><div class="stat-label">오늘 예약</div></div>' +
    '<div class="admin-stat-card"><div class="stat-num">' + upcoming + '</div><div class="stat-label">예정 예약</div></div>' +
    '<div class="admin-stat-card"><div class="stat-num">' + past + '</div><div class="stat-label">지난 예약</div></div>';

  if (adminSecurityAlerts) {
    html += '<div class="admin-stat-card"><div class="stat-num">' + Number(adminSecurityAlerts.adminFailCount || 0) + '</div><div class="stat-label">최근 관리자 실패(' + Number(adminSecurityAlerts.windowMinutes || 60) + '분)</div></div>';
    html += '<div class="admin-stat-card"><div class="stat-num">' + Number(adminSecurityAlerts.reservationFailCount || 0) + '</div><div class="stat-label">최근 예약 인증 실패</div></div>';
  }

  document.getElementById('adminStats').innerHTML = html;
}

function adminFilter(el) {
  document.querySelectorAll('.admin-filter-chip').forEach(function(c) {
    c.classList.remove('active');
  });
  el.classList.add('active');
  adminCurrentFilter = el.dataset.filter;
  renderAdminList();
}

function renderAdminList() {
  var list = document.getElementById('adminReservationsList');
  var today = formatDate(new Date());
  var filtered = adminReservations;

  switch (adminCurrentFilter) {
    case 'today':
      filtered = filtered.filter(function(r) { return r['날짜'] === today; });
      break;
    case 'past':
      filtered = filtered.filter(function(r) { return r['날짜'] < today; });
      break;
    case '6F':
    case '7F':
    case '8F':
    case '9F':
      filtered = filtered.filter(function(r) { return r['층'] === adminCurrentFilter; });
      break;
  }

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="empty-state">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        '<p>해당 조건의 예약이 없습니다</p>' +
      '</div>';
    return;
  }

  // 날짜별 그룹핑
  var grouped = {};
  filtered.forEach(function(r) {
    if (!grouped[r['날짜']]) grouped[r['날짜']] = [];
    grouped[r['날짜']].push(r);
  });

  var html = '';
  Object.keys(grouped).sort().forEach(function(date) {
    var isPast = date < today;
    html += '<div class="date-badge" style="' + (isPast ? 'opacity:0.5' : '') + '">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
      formatDateKr(date) + (isPast ? ' (지남)' : '') +
    '</div>';

    grouped[date].forEach(function(r) {
      html +=
        '<div class="admin-reservation-card fade-in" style="' + (isPast ? 'opacity:0.6' : '') + '">' +
          '<div class="admin-card-top">' +
            '<span class="card-floor">' + escapeHtml(r['층']) + '</span>' +
            '<button class="btn btn-outline-red" style="padding:6px 14px; font-size:12px; min-height:32px;" data-action="admin-delete-one" data-id="' + escapeHtml(r['예약ID']) + '">삭제</button>' +
          '</div>' +
          '<div class="admin-card-meta">' +
            '<div class="meta-item"><span class="meta-label">시간</span><span class="meta-value">' + escapeHtml(r['시작시간']) + '~' + escapeHtml(r['종료시간']) + '</span></div>' +
            '<div class="meta-item"><span class="meta-label">팀</span><span class="meta-value">' + escapeHtml(r['팀명']) + '</span></div>' +
            '<div class="meta-item"><span class="meta-label">예약자</span><span class="meta-value">' + escapeHtml(r['예약자']) + '</span></div>' +
          '</div>' +
        '</div>';
    });
  });

  list.innerHTML = html;
}

function adminDeleteOne(id) {
  var reservation = adminReservations.find(function(r) { return r['예약ID'] === id; });
  if (!reservation) return;

  document.getElementById('adminDeleteTitle').textContent = '이 예약을 삭제하시겠습니까?';
  document.getElementById('adminDeleteDesc').textContent =
    reservation['날짜'] + ' ' + reservation['시작시간'] + '~' + reservation['종료시간'] +
    ' (' + reservation['층'] + ' / ' + reservation['팀명'] + ')';

  openModal('modalAdminDelete');

  document.getElementById('adminDeleteConfirmBtn').onclick = async function() {
    closeModal('modalAdminDelete');
    showLoading(true);

    try {
      var res = await apiPost({
        action: 'deleteReservation',
        id: id,
        adminToken: adminAuthToken
      });

      showLoading(false);

      if (res.success) {
        showToast('예약이 삭제되었습니다.', 'success');
        adminRefresh();
      } else {
        showToast(res.error || '삭제에 실패했습니다.', 'error');
        if (res.error && (res.error.indexOf('비밀번호') >= 0 || res.error.indexOf('토큰') >= 0)) {
          showToast('관리자 코드가 올바르지 않습니다.', 'error');
          exitAdminMode();
        }
      }
    } catch (e) {
      showLoading(false);
      showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
  };
}

function adminDeletePast() {
  var today = formatDate(new Date());
  var pastReservations = adminReservations.filter(function(r) { return r['날짜'] < today; });

  if (pastReservations.length === 0) {
    showToast('정리할 지난 예약이 없습니다.', '');
    return;
  }

  document.getElementById('adminDeleteTitle').textContent = '지난 예약을 모두 삭제하시겠습니까?';
  document.getElementById('adminDeleteDesc').textContent =
    pastReservations.length + '건의 지난 예약이 삭제됩니다.';

  openModal('modalAdminDelete');

  document.getElementById('adminDeleteConfirmBtn').onclick = async function() {
    closeModal('modalAdminDelete');
    showLoading(true);

    var successCount = 0;
    var failCount = 0;

    for (var i = 0; i < pastReservations.length; i++) {
      try {
        var res = await apiPost({
          action: 'deleteReservation',
          id: pastReservations[i]['예약ID'],
          adminToken: adminAuthToken
        });
        if (res.success) {
          successCount++;
        } else {
          failCount++;
          if (res.error && (res.error.indexOf('비밀번호') >= 0 || res.error.indexOf('토큰') >= 0)) {
            showLoading(false);
            showToast('관리자 코드가 올바르지 않습니다.', 'error');
            exitAdminMode();
            return;
          }
        }
      } catch (e) {
        failCount++;
      }
    }

    showLoading(false);

    if (failCount === 0) {
      showToast(successCount + '건의 지난 예약이 정리되었습니다.', 'success');
    } else {
      showToast(successCount + '건 삭제 / ' + failCount + '건 실패', 'error');
    }

    adminRefresh();
  };
}

// ═══════════════════════════════════════════════════════
// 관리자 - 회의실 관리
// ═══════════════════════════════════════════════════════
var adminRooms = [];

async function loadAdminRooms() {
  var list = document.getElementById('adminRoomsList');
  list.innerHTML = '<div style="text-align:center; padding:20px 0;"><div class="spinner" style="margin:0 auto;"></div></div>';

  try {
    var res = await apiGet('getRooms', {});
    if (res.success) {
      adminRooms = res.data || [];
      renderAdminRooms();
    } else {
      list.innerHTML = '<div class="empty-state"><p>데이터를 불러올 수 없습니다.</p></div>';
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(formatApiError(e, '서버 연결에 실패했습니다.')) + '</p></div>';
  }
}

function renderAdminRooms() {
  var list = document.getElementById('adminRoomsList');

  if (adminRooms.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>등록된 회의실이 없습니다</p></div>';
    return;
  }

  var html = '';
  adminRooms.forEach(function(room) {
    var isActive = room['활성화'] === true;
    html +=
      '<div class="room-card' + (isActive ? '' : ' disabled') + ' fade-in">' +
        '<div class="room-icon">' + escapeHtml(room['층']) + '</div>' +
        '<div class="room-info">' +
          '<div class="room-name">' + escapeHtml(room['이름']) + '</div>' +
          '<div class="room-status">' +
            '<span class="active-dot ' + (isActive ? 'on' : 'off') + '"></span>' +
            (isActive ? '활성 - 예약 가능' : '비활성 - 예약 불가') +
          '</div>' +
        '</div>' +
        '<div class="room-actions">' +
          '<button class="room-toggle-btn ' + (isActive ? 'deactivate' : 'activate') + '" data-action="admin-toggle-room" data-room-id="' + escapeHtml(room['회의실ID']) + '" data-active="' + (!isActive) + '">' +
            (isActive ? '비활성화' : '활성화') +
          '</button>' +
          '<button class="room-delete-btn" data-action="admin-remove-room" data-room-id="' + escapeHtml(room['회의실ID']) + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>';
  });

  list.innerHTML = html;
}

async function adminToggleRoom(roomId, active) {
  showLoading(true);

  try {
    var res = await apiPost({
      action: 'updateRoom',
      adminToken: adminAuthToken,
      roomId: roomId,
      active: active
    });

    showLoading(false);

    if (res.success) {
      showToast(active ? '회의실이 활성화되었습니다.' : '회의실이 비활성화되었습니다.', 'success');
      loadAdminRooms();
    } else {
      showToast(res.error || '변경에 실패했습니다.', 'error');
    }
  } catch (e) {
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

async function adminAddRoom() {
  var floor = document.getElementById('newRoomFloor').value.trim();
  var name = document.getElementById('newRoomName').value.trim();

  if (!floor || !name) {
    showToast('층과 이름을 모두 입력하세요.', 'error');
    return;
  }

  showLoading(true);

  try {
    var res = await apiPost({
      action: 'addRoom',
      adminToken: adminAuthToken,
      floor: floor,
      name: name
    });

    showLoading(false);

    if (res.success) {
      showToast('회의실이 추가되었습니다.', 'success');
      document.getElementById('newRoomFloor').value = '';
      document.getElementById('newRoomName').value = '';
      loadAdminRooms();
    } else {
      showToast(res.error || '추가에 실패했습니다.', 'error');
    }
  } catch (e) {
    showLoading(false);
    showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
  }
}

function adminRemoveRoom(roomId) {
  document.getElementById('adminDeleteTitle').textContent = '이 회의실을 삭제하시겠습니까?';
  document.getElementById('adminDeleteDesc').textContent = roomId + ' 회의실이 영구 삭제됩니다.';

  openModal('modalAdminDelete');

  document.getElementById('adminDeleteConfirmBtn').onclick = async function() {
    closeModal('modalAdminDelete');
    showLoading(true);

    try {
      var res = await apiPost({
        action: 'deleteRoom',
        adminToken: adminAuthToken,
        roomId: roomId
      });

      showLoading(false);

      if (res.success) {
        showToast('회의실이 삭제되었습니다.', 'success');
        loadAdminRooms();
      } else {
        showToast(res.error || '삭제에 실패했습니다.', 'error');
      }
    } catch (e) {
      showLoading(false);
      showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
  };
}

// ═══════════════════════════════════════════════════════
// PWA 앱 설치 배너
// ═══════════════════════════════════════════════════════
var deferredInstallPrompt = null;

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function initInstallBanner() {
  // 이미 앱으로 실행 중이면 표시 안 함
  if (isInStandaloneMode()) return;

  // 사용자가 배너를 닫은 적 있으면 표시 안 함
  var dismissed = localStorage.getItem('installBannerDismissed');
  if (dismissed) {
    var dismissedTime = parseInt(dismissed, 10);
    // 7일 지나면 다시 표시
    if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) return;
  }

  // Android Chrome: beforeinstallprompt 이벤트 수신
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallBanner();
  });

  // iOS: 바로 배너 표시
  if (isIos()) {
    showInstallBanner();
  }
}

function showInstallBanner() {
  var banner = document.getElementById('installBanner');
  banner.classList.add('show');
}

function handleInstallClick() {
  if (deferredInstallPrompt) {
    // Android: 네이티브 설치 프롬프트 실행
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(result) {
      if (result.outcome === 'accepted') {
        document.getElementById('installBanner').classList.remove('show');
      }
      deferredInstallPrompt = null;
    });
  } else if (isIos()) {
    // iOS: 설치 가이드 모달 표시
    openModal('modalIosGuide');
  }
}

function dismissInstallBanner() {
  document.getElementById('installBanner').classList.remove('show');
  localStorage.setItem('installBannerDismissed', String(Date.now()));
}

// 설치 완료 감지
window.addEventListener('appinstalled', function() {
  document.getElementById('installBanner').classList.remove('show');
  deferredInstallPrompt = null;
  showToast('앱이 설치되었습니다!', 'success');
});
