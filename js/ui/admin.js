
import { apiGet, apiPost } from '../api.js';
import { state } from '../state.js';
import {
    escapeHtml, formatDate, formatDateKr, normalizeDate, normalizeTime, formatApiError
} from '../utils.js';
import { showLoading, showToast, openModal, closeModal, showScreen } from './common.js';
import { loadRoomsForHome } from './home.js';

var adminReservations = [];
var adminSecurityAlerts = null;
var adminCurrentFilter = 'all';
var adminRooms = [];

export function switchAdminTab(el) {
    document.querySelectorAll('#screenAdmin .tab-item').forEach(function (t) {
        t.classList.remove('active');
    });
    el.classList.add('active');

    var tab = el.dataset.admintab;
    const tabRes = document.getElementById('adminTabReservations');
    const tabRooms = document.getElementById('adminTabRooms');

    if (tabRes) tabRes.style.display = tab === 'reservations' ? '' : 'none';
    if (tabRooms) tabRooms.style.display = tab === 'rooms' ? '' : 'none';

    if (tab === 'rooms') {
        loadAdminRooms();
    }
}

// ═══════════════════════════════════════════════════════
// 관리자 인증
// ═══════════════════════════════════════════════════════
export function openAdminAuth() {
    document.getElementById('adminCodeInput').value = '';
    openModal('modalAdminAuth');

    // Enter key support
    const input = document.getElementById('adminCodeInput');
    input.onkeydown = function (e) {
        if (e.key === 'Enter') verifyAdminCode();
    };
}

export async function verifyAdminCode() {
    const code = document.getElementById('adminCodeInput').value.trim();
    if (!code) {
        showToast('코드를 입력하세요.', 'error');
        return;
    }

    showLoading(true);
    closeModal('modalAdminAuth');

    try {
        const res = await apiPost({
            action: 'verifyAdmin',
            code: code
        });

        showLoading(false);

        if (res.success) {
            // Token handling
            const token = res.token || (res.data && res.data.token) || '';
            if (!token) {
                showToast('서버가 토큰 인증을 지원하지 않습니다.', 'error');
                return;
            }
            state.adminAuthToken = token;

            document.body.classList.add('admin-mode');
            showToast('관리자 모드로 진입했습니다.', 'success');
            showScreen('screenAdmin');

            // Load initial admin data
            await adminRefresh();
            await loadAdminRooms();
        } else {
            showToast('코드가 올바르지 않습니다.', 'error');
        }
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

export function exitAdminMode() {
    state.adminAuthToken = null;
    document.body.classList.remove('admin-mode');
    showToast('관리자 모드를 종료합니다.');
    showScreen('screenHome');
}

// ═══════════════════════════════════════════════════════
// 관리자 대시보드 (예약 관리)
// ═══════════════════════════════════════════════════════
export async function adminRefresh() {
    showLoading(true);
    const list = document.getElementById('adminReservationsList');
    if (list) list.innerHTML = '';

    try {
        const res = await apiGet('getReservations', {});
        showLoading(false);

        if (res.success) {
            adminReservations = (res.data || []).map(function (r) {
                r['날짜'] = normalizeDate(r['날짜']);
                r['시작시간'] = normalizeTime(r['시작시간']);
                r['종료시간'] = normalizeTime(r['종료시간']);
                return r;
            }).sort(function (a, b) {
                if (a['날짜'] !== b['날짜']) return a['날짜'] < b['날짜'] ? -1 : 1;
                return a['시작시간'] < b['시작시간'] ? -1 : 1;
            });

            await loadAdminSecurityAlerts();
            renderAdminStats();
            renderAdminList();
        } else {
            if (list) list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(res.error || '데이터를 불러올 수 없습니다.') + '</p></div>';
        }
    } catch (e) {
        showLoading(false);
        if (list) list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(formatApiError(e, '서버에 연결할 수 없습니다.')) + '</p></div>';
    }
}

async function loadAdminSecurityAlerts() {
    if (!state.adminAuthToken) {
        adminSecurityAlerts = null;
        return;
    }

    try {
        const alertRes = await apiGet('getSecurityAlerts', { adminToken: state.adminAuthToken });
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
    const statsDiv = document.getElementById('adminStats');
    if (!statsDiv) return;

    const today = formatDate(new Date());
    const total = adminReservations.length;
    const todayCount = adminReservations.filter(function (r) { return r['날짜'] === today; }).length;
    const upcoming = adminReservations.filter(function (r) { return r['날짜'] >= today; }).length;
    const past = adminReservations.filter(function (r) { return r['날짜'] < today; }).length;

    let html =
        '<div class="admin-stat-card"><div class="stat-num">' + total + '</div><div class="stat-label">전체 예약</div></div>' +
        '<div class="admin-stat-card"><div class="stat-num">' + todayCount + '</div><div class="stat-label">오늘 예약</div></div>' +
        '<div class="admin-stat-card"><div class="stat-num">' + upcoming + '</div><div class="stat-label">예정 예약</div></div>' +
        '<div class="admin-stat-card"><div class="stat-num">' + past + '</div><div class="stat-label">지난 예약</div></div>';

    if (adminSecurityAlerts) {
        html += '<div class="admin-stat-card"><div class="stat-num">' + Number(adminSecurityAlerts.adminFailCount || 0) + '</div><div class="stat-label">최근 관리자 실패(' + Number(adminSecurityAlerts.windowMinutes || 60) + '분)</div></div>';
        html += '<div class="admin-stat-card"><div class="stat-num">' + Number(adminSecurityAlerts.reservationFailCount || 0) + '</div><div class="stat-label">최근 예약 인증 실패</div></div>';
    }

    statsDiv.innerHTML = html;
}

export function adminFilter(el) {
    document.querySelectorAll('.admin-filter-chip').forEach(function (c) {
        c.classList.remove('active');
    });
    el.classList.add('active');
    adminCurrentFilter = el.dataset.filter;
    renderAdminList();
}

export function renderAdminList() {
    const list = document.getElementById('adminReservationsList');
    if (!list) return;

    const today = formatDate(new Date());
    let filtered = adminReservations;

    switch (adminCurrentFilter) {
        case 'today':
            filtered = filtered.filter(function (r) { return r['날짜'] === today; });
            break;
        case 'past':
            filtered = filtered.filter(function (r) { return r['날짜'] < today; });
            break;
        case '6F':
        case '7F':
        case '8F':
        case '9F':
            filtered = filtered.filter(function (r) { return r['층'] === adminCurrentFilter; });
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
    const grouped = {};
    filtered.forEach(function (r) {
        if (!grouped[r['날짜']]) grouped[r['날짜']] = [];
        grouped[r['날짜']].push(r);
    });

    let html = '';
    Object.keys(grouped).sort().forEach(function (date) {
        const isPast = date < today;
        html += '<div class="date-badge" style="' + (isPast ? 'opacity:0.5' : '') + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
            formatDateKr(date) + (isPast ? ' (지남)' : '') +
            '</div>';

        grouped[date].forEach(function (r) {
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

export function adminDeleteOne(id) {
    const reservation = adminReservations.find(function (r) { return r['예약ID'] === id; });
    if (!reservation) return;

    document.getElementById('adminDeleteTitle').textContent = '이 예약을 삭제하시겠습니까?';
    document.getElementById('adminDeleteDesc').textContent =
        reservation['날짜'] + ' ' + reservation['시작시간'] + '~' + reservation['종료시간'] +
        ' (' + reservation['층'] + ' / ' + reservation['팀명'] + ')';

    openModal('modalAdminDelete');

    document.getElementById('adminDeleteConfirmBtn').onclick = async function () {
        closeModal('modalAdminDelete');
        showLoading(true);

        try {
            const res = await apiPost({
                action: 'deleteReservation',
                id: id,
                adminToken: state.adminAuthToken
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

export function adminDeletePast() {
    const today = formatDate(new Date());
    const pastReservations = adminReservations.filter(function (r) { return r['날짜'] < today; });

    if (pastReservations.length === 0) {
        showToast('정리할 지난 예약이 없습니다.', '');
        return;
    }

    document.getElementById('adminDeleteTitle').textContent = '지난 예약을 모두 삭제하시겠습니까?';
    document.getElementById('adminDeleteDesc').textContent =
        pastReservations.length + '건의 지난 예약이 삭제됩니다.';

    openModal('modalAdminDelete');

    document.getElementById('adminDeleteConfirmBtn').onclick = async function () {
        closeModal('modalAdminDelete');
        showLoading(true);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < pastReservations.length; i++) {
            try {
                const res = await apiPost({
                    action: 'deleteReservation',
                    id: pastReservations[i]['예약ID'],
                    adminToken: state.adminAuthToken
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
export async function loadAdminRooms() {
    const list = document.getElementById('adminRoomsList');
    if (list) list.innerHTML = '<div style="text-align:center; padding:20px 0;"><div class="spinner" style="margin:0 auto;"></div></div>';

    try {
        const res = await apiGet('getRooms', {
            includeInactive: '1',
            adminToken: state.adminAuthToken
        });
        if (res.success) {
            adminRooms = res.data || [];
            renderAdminRooms();
        } else {
            if (list) list.innerHTML = '<div class="empty-state"><p>데이터를 불러올 수 없습니다.</p></div>';
        }
    } catch (e) {
        if (list) list.innerHTML = '<div class="empty-state"><p>' + escapeHtml(formatApiError(e, '서버 연결에 실패했습니다.')) + '</p></div>';
    }
}

function renderAdminRooms() {
    const list = document.getElementById('adminRoomsList');
    if (!list) return;

    if (adminRooms.length === 0) {
        list.innerHTML = '<div class="empty-state"><p>등록된 회의실이 없습니다</p></div>';
        return;
    }

    let html = '';
    adminRooms.forEach(function (room) {
        const isActive = room['활성화'] === true;
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
            '<button class="room-edit-btn" data-action="admin-edit-room" data-room-id="' + escapeHtml(room['회의실ID']) + '">수정</button>' +
            '<button class="room-delete-btn" data-action="admin-remove-room" data-room-id="' + escapeHtml(room['회의실ID']) + '">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
            '</button>' +
            '</div>' +
            '</div>';
    });

    list.innerHTML = html;
}

function getAdminRoomById(roomId) {
    return adminRooms.find(function (room) {
        return String(room['회의실ID']) === String(roomId);
    }) || null;
}

async function syncRoomViewsAfterAdminChange() {
    await loadAdminRooms();
    await loadRoomsForHome();
}

export function adminEditRoom(roomId) {
    const room = getAdminRoomById(roomId);
    if (!room) {
        showToast('회의실 정보를 찾을 수 없습니다.', 'error');
        return;
    }

    document.getElementById('adminRoomEditDesc').textContent = room['층'] + ' / ' + room['회의실ID'];
    document.getElementById('adminRoomEditName').value = String(room['이름'] || '');
    openModal('modalAdminRoomEdit');

    document.getElementById('adminRoomEditConfirmBtn').onclick = async function () {
        const name = document.getElementById('adminRoomEditName').value.trim();
        if (!name) {
            showToast('회의실 이름을 입력하세요.', 'error');
            return;
        }

        closeModal('modalAdminRoomEdit');
        showLoading(true);

        try {
            const res = await apiPost({
                action: 'updateRoom',
                adminToken: state.adminAuthToken,
                roomId: roomId,
                name: name
            });

            showLoading(false);

            if (res.success) {
                showToast('회의실 정보가 수정되었습니다.', 'success');
                await syncRoomViewsAfterAdminChange();
            } else {
                showToast(res.error || '수정에 실패했습니다.', 'error');
            }
        } catch (e) {
            showLoading(false);
            showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
        }
    };
}

export async function adminToggleRoom(roomId, active) {
    showLoading(true);

    try {
        const res = await apiPost({
            action: 'updateRoom',
            adminToken: state.adminAuthToken,
            roomId: roomId,
            active: active
        });

        showLoading(false);

        if (res.success) {
            showToast(active ? '회의실이 활성화되었습니다.' : '회의실이 비활성화되었습니다.', 'success');
            await syncRoomViewsAfterAdminChange();
        } else {
            showToast(res.error || '변경에 실패했습니다.', 'error');
        }
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

export async function adminAddRoom() {
    const floor = document.getElementById('newRoomFloor').value.trim().toUpperCase();
    const name = document.getElementById('newRoomName').value.trim();

    if (!floor || !name) {
        showToast('층과 이름을 모두 입력하세요.', 'error');
        return;
    }

    showLoading(true);

    try {
        const res = await apiPost({
            action: 'addRoom',
            adminToken: state.adminAuthToken,
            floor: floor,
            name: name
        });

        showLoading(false);

        if (res.success) {
            showToast('회의실이 추가되었습니다.', 'success');
            document.getElementById('newRoomFloor').value = '';
            document.getElementById('newRoomName').value = '';
            await syncRoomViewsAfterAdminChange();
        } else {
            showToast(res.error || '추가에 실패했습니다.', 'error');
        }
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

export function adminRemoveRoom(roomId) {
    document.getElementById('adminDeleteTitle').textContent = '이 회의실을 삭제하시겠습니까?';
    document.getElementById('adminDeleteDesc').textContent = roomId + ' 회의실이 영구 삭제됩니다.';

    openModal('modalAdminDelete');

    document.getElementById('adminDeleteConfirmBtn').onclick = async function () {
        closeModal('modalAdminDelete');
        showLoading(true);

        try {
            const res = await apiPost({
                action: 'deleteRoom',
                adminToken: state.adminAuthToken,
                roomId: roomId
            });

            showLoading(false);

            if (res.success) {
                showToast('회의실이 삭제되었습니다.', 'success');
                await syncRoomViewsAfterAdminChange();
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
// 관리자 - 운영 지표 및 점검
// ═══════════════════════════════════════════════════════
export async function adminLoadMetrics() {
    showLoading(true);
    try {
        const metricsRes = await apiGet('getOperationalMetrics', { adminToken: state.adminAuthToken });
        if (!metricsRes.success) {
            showLoading(false);
            showToast(metricsRes.error || '운영 지표 조회에 실패했습니다.', 'error');
            return;
        }

        renderAdminMetrics(metricsRes.data || {});
        openModal('modalAdminMetrics');

        const trendRes = await apiGet('getOperationalMetricsTrend', { adminToken: state.adminAuthToken });
        renderAdminMetricsTrend(trendRes.success ? (trendRes.data || {}) : {});

        showLoading(false);
        await adminPreviewMetricsReport();
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

function renderAdminMetrics(data) {
    var grid = document.getElementById('adminMetricsGrid');
    var summary = document.getElementById('adminMetricsSummary');
    if (!grid) return;

    var items = [
        { label: '예약 생성', value: Number(data.reservationCreate || 0) + '건' },
        { label: '예약 수정', value: Number(data.reservationUpdate || 0) + '건' },
        { label: '예약 삭제', value: Number(data.reservationDelete || 0) + '건' },
        { label: '예약 인증 실패', value: Number(data.passwordFail || 0) + '건' },
        { label: '관리자 인증 실패', value: Number(data.adminFail || 0) + '건' },
        { label: '회의실 변경', value: Number(data.roomChanges || 0) + '건' },
        { label: '활성 회의실', value: Number(data.activeRooms || 0) + '개' },
        { label: '향후 예약', value: Number(data.upcomingReservations || 0) + '건' }
    ];

    var html = '';
    items.forEach(function (it) {
        html += '<div class="admin-metric-card">' +
            '<div class="k">' + escapeHtml(it.label) + '</div>' +
            '<div class="v">' + escapeHtml(String(it.value)) + '</div>' +
            '</div>';
    });
    grid.innerHTML = html;

    if (summary) {
        summary.textContent = '집계 기간: 최근 ' + Number(data.windowDays || 30) + '일';
    }
}

function renderAdminMetricsTrend(data) {
    var wrap = document.getElementById('adminMetricsTrend');
    if (!wrap) return;

    var days = (data && data.days) || [];
    var series = (data && data.series) || {};
    var createSeries = series.reservationCreate || [];
    var failSeries = series.authFail || [];
    var avgSeries = series.authFailMovingAvg7 || [];
    var anomalies = (data && data.anomalies) || {};
    var anomalyMessages = Array.isArray(anomalies.messages) ? anomalies.messages : [];

    if (!days.length) {
        wrap.innerHTML = '<div class="admin-check-item warn"><div class="label">no-data</div><div class="detail">추이 데이터가 없습니다.</div></div>';
        return;
    }

    var start = Math.max(0, days.length - 7);
    let html = '';
    if (anomalyMessages.length > 0) {
        html += '<div class="admin-anomaly-box warn">' +
            '<div class="h">이상치 경고</div>' +
            '<ul>' + anomalyMessages.map(function (msg) {
                return '<li>' + escapeHtml(String(msg)) + '</li>';
            }).join('') + '</ul>' +
            '</div>';
    } else {
        html += '<div class="admin-anomaly-box ok"><div class="h">이상치 탐지</div><div class="d">최근 구간에서 연속 증가/급증 패턴이 감지되지 않았습니다.</div></div>';
    }
    html += '<div class="admin-trend-head">최근 7일 추이 (인증실패 7일 이동평균)</div>';
    html += '<div class="admin-trend-grid">';
    for (var i = start; i < days.length; i++) {
        html += '<div class="admin-trend-row">' +
            '<div class="d">' + escapeHtml(days[i].slice(5)) + '</div>' +
            '<div class="m">예약생성 ' + Number(createSeries[i] || 0) + '</div>' +
            '<div class="m">인증실패 ' + Number(failSeries[i] || 0) + '</div>' +
            '<div class="m">7일평균 ' + Number(avgSeries[i] || 0) + '</div>' +
            '</div>';
    }
    html += '</div>';
    wrap.innerHTML = html;
}

export async function adminPreviewMetricsReport() {
    showLoading(true);
    try {
        const res = await apiGet('getOperationalMetricsReport', { adminToken: state.adminAuthToken });
        showLoading(false);
        if (!res.success) {
            showToast(res.error || '리포트 조회에 실패했습니다.', 'error');
            return;
        }

        var data = res.data || {};
        var area = document.getElementById('adminMetricsReportText');
        if (area) area.value = String(data.reportText || '리포트 데이터가 없습니다.');
        if (Array.isArray(data.recipients) && data.recipients.length > 0) {
            showToast('리포트 수신자: ' + data.recipients.join(', '), data.hasAlert ? 'warning' : 'success');
        }
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

export async function adminSendMetricsReport() {
    if (!state.adminAuthToken) return;
    if (!confirm('월간 운영 리포트를 설정된 이메일로 발송할까요?')) return;

    showLoading(true);
    try {
        const res = await apiPost({
            action: 'sendOperationalMetricsReport',
            adminToken: state.adminAuthToken
        });
        showLoading(false);

        if (!res.success) {
            showToast(res.error || '리포트 발송에 실패했습니다.', 'error');
            return;
        }

        const data = res.data || {};
        const recipients = Array.isArray(data.recipients) ? data.recipients.join(', ') : '';
        showToast('리포트 발송 완료' + (recipients ? ' (' + recipients + ')' : ''), 'success');
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}

export async function adminRunChecks() {
    showLoading(true);
    try {
        const res = await apiGet('getOperationalChecks', { adminToken: state.adminAuthToken });
        showLoading(false);

        if (!res.success) {
            showToast(res.error || '운영 점검에 실패했습니다.', 'error');
            return;
        }

        const data = res.data || {};
        const summary = document.getElementById('adminChecksSummary');
        const list = document.getElementById('adminChecksList');
        if (!summary || !list) return;

        summary.textContent = '총 ' + Number(data.total || 0) + '개 항목 · 정상 ' + Number(data.okCount || 0) + ' · 경고 ' + Number(data.failCount || 0);

        let html = '';
        (data.checks || []).forEach(function (c) {
            html += '<div class="admin-check-item ' + (c.ok ? 'ok' : 'warn') + '">' +
                '<div class="label">' + escapeHtml(String(c.key || 'check')) + '</div>' +
                '<div class="detail">' + escapeHtml(String(c.detail || '')) + '</div>' +
                '</div>';
        });
        list.innerHTML = html || '<div class="admin-check-item warn"><div class="label">no-data</div><div class="detail">점검 데이터가 없습니다.</div></div>';

        openModal('modalAdminChecks');
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
}
