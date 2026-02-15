
import { apiGet, apiPost } from '../api.js';
import { state } from '../state.js';
import {
    escapeHtml, formatDate, formatDateKr, normalizeDate, normalizeTime, addMinutes, formatApiError
} from '../utils.js';
import { showLoading, showToast, openModal, closeModal, showScreen } from './common.js';

// ═══════════════════════════════════════════════════════
// 예약 시작
// ═══════════════════════════════════════════════════════
export function startReservation() {
    if (!state.selectedFloor) return;

    state.editReservationId = null;
    state.reservationAuthToken = null;
    state.selectedDate = null;
    state.selectedStartTime = null;
    state.selectedEndTime = null;
    state.calendarYear = new Date().getFullYear();
    state.calendarMonth = new Date().getMonth();

    const title = document.getElementById('reserveTitle');
    if (title) title.textContent = state.selectedFloor + ' 예약하기';

    const sub = document.getElementById('reserveSubtitle');
    if (sub) sub.textContent = 'J동 ' + state.selectedFloor + ' 회의실';

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
// 달력
// ═══════════════════════════════════════════════════════
export function renderCalendar() {
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
    ['일', '월', '화', '수', '목', '금', '토'].forEach(function (d) {
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

export function changeMonth(dir) {
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

export function selectDate(dateStr) {
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
            reservedSlots = (res.data || []).map(function (r) {
                r['시작시간'] = normalizeTime(r['시작시간']);
                r['종료시간'] = normalizeTime(r['종료시간']);
                return r;
            });
        }
    } catch (e) {
        // 오프라인 모드
    }

    showLoading(false);
    if (state.editReservationId) {
        reservedSlots = reservedSlots.filter(function (r) {
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

    var SLOT_OPEN = '07:00';
    var SLOT_CLOSE = '21:00';

    for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m += 30) {
            const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            const displayTime = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
            let classes = 'time-slot';

            var isHidden = (time >= SLOT_CLOSE || time < SLOT_OPEN);
            if (isHidden) {
                classes += ' time-slot-hidden';
            }

            const isReserved = reservedSlots.some(function (r) {
                return time >= r['시작시간'] && time < r['종료시간'];
            });

            if (isReserved) {
                classes += ' reserved';
            }

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

function hasConflictInRange(startTime, endTime) {
    var reserved = state.currentReservedSlots || [];
    for (var i = 0; i < reserved.length; i++) {
        var r = reserved[i];
        if (startTime < r['종료시간'] && endTime > r['시작시간']) {
            return true;
        }
    }
    return false;
}

export function selectTime(time) {
    const hint = document.getElementById('timeHint');

    if (!state.selectedStartTime) {
        state.selectedStartTime = time;
        state.selectedEndTime = null;
        hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
    } else if (!state.selectedEndTime) {
        if (time < state.selectedStartTime) {
            state.selectedStartTime = time;
            state.selectedEndTime = null;
            hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
        } else {
            var candidateEnd = addMinutes(time, 30);
            if (hasConflictInRange(state.selectedStartTime, candidateEnd)) {
                showToast('선택한 시간 구간에 이미 예약이 있습니다.', 'error');
                state.selectedEndTime = null;
                hint.textContent = '종료 시간을 다시 선택하세요 (시작: ' + state.selectedStartTime + ')';
            } else {
                state.selectedEndTime = candidateEnd;
                hint.textContent = state.selectedStartTime + ' ~ ' + state.selectedEndTime;
                showFormSection();
            }
        }
    } else {
        state.selectedStartTime = time;
        state.selectedEndTime = null;
        hint.textContent = '종료 시간을 선택하세요 (시작: ' + time + ')';
        document.getElementById('formDivider').style.display = 'none';
        document.getElementById('formSection').style.display = 'none';
    }

    // Re-render highlighting
    renderTimeGrid(state.currentReservedSlots || []);

    updateConfirmButton();
    if (state.editReservationId && state.selectedEndTime) {
        renderSelectionSummary();
    }
}

// ═══════════════════════════════════════════════════════
// 폼 및 제출
// ═══════════════════════════════════════════════════════

function showFormSection() {
    document.getElementById('formDivider').style.display = 'block';
    const section = document.getElementById('formSection');
    section.style.display = 'block';

    renderSelectionSummary();

    setTimeout(function () {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
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

export function updateConfirmButton() {
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

export function handleConfirmReservation() {
    if (state.editReservationId) {
        return submitUpdate(state.editReservationId);
    }
    return submitReservation();
}

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
            const completeData = res.data || {
                '날짜': state.selectedDate,
                '층': state.selectedFloor,
                '시작시간': state.selectedStartTime,
                '종료시간': state.selectedEndTime,
                '팀명': document.getElementById('inputTeam').value.trim(),
                '예약자': document.getElementById('inputName').value.trim()
            };
            showCompleteScreen(completeData);
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
    if (card) {
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
    }
    showScreen('screenComplete');
}

// ═══════════════════════════════════════════════════════
// 내 예약 조회
// ═══════════════════════════════════════════════════════
export async function loadReservations() {
    const list = document.getElementById('reservationsList');
    list.innerHTML = '<div style="text-align:center; padding:40px 0;"><div class="spinner" style="margin:0 auto;"></div></div>';

    try {
        const res = await apiGet('getReservations', {});

        if (res.success) {
            state.reservations = (res.data || []).map(function (r) {
                r['날짜'] = normalizeDate(r['날짜']);
                r['시작시간'] = normalizeTime(r['시작시간']);
                r['종료시간'] = normalizeTime(r['종료시간']);
                return r;
            }).sort(function (a, b) {
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
        filtered = filtered.filter(function (r) {
            return r['층'] === state.currentTab;
        });
    }

    const today = formatDate(new Date());
    filtered = filtered.filter(function (r) {
        return r['날짜'] >= today;
    });

    if (filtered.length === 0) {
        list.innerHTML =
            '<div class="empty-state">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
            '<p>예약된 회의실이 없습니다</p>' +
            '</div>';
        return;
    }

    const grouped = {};
    filtered.forEach(function (r) {
        if (!grouped[r['날짜']]) grouped[r['날짜']] = [];
        grouped[r['날짜']].push(r);
    });

    let html = '';
    Object.keys(grouped).sort().forEach(function (date) {
        html += '<div class="date-badge">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
            formatDateKr(date) +
            '</div>';

        grouped[date].forEach(function (r) {
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

export function switchTab(el) {
    document.querySelectorAll('.tab-item').forEach(function (t) {
        t.classList.remove('active');
    });
    el.classList.add('active');
    state.currentTab = el.dataset.tab;
    renderReservations();
}

// ═══════════════════════════════════════════════════════
// 수정 및 삭제 (Modal Logic Included)
// ═══════════════════════════════════════════════════════
export function requestEdit(id) {
    state.reservationAuthToken = null;
    state.pendingAction = 'edit';
    state.pendingId = id;
    const input = document.getElementById('modalPasswordInput');
    if (input) input.value = '';
    openModal('modalPassword');

    const confirmBtn = document.getElementById('modalPasswordConfirm');
    if (confirmBtn) {
        confirmBtn.onclick = function () {
            verifyAndEdit(id);
        };
    }
}

export function requestDelete(id) {
    state.reservationAuthToken = null;
    state.pendingAction = 'delete';
    state.pendingId = id;
    state.deleteTargetReservation = null;
    const input = document.getElementById('modalPasswordInput');
    if (input) input.value = '';
    openModal('modalPassword');

    const confirmBtn = document.getElementById('modalPasswordConfirm');
    if (confirmBtn) {
        confirmBtn.onclick = function () {
            verifyAndDelete(id);
        };
    }
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
            // Need to parse token - helper in app.js?
            // Let's implement generic token helper here or in utils
            const token = res.token || (res.data && res.data.token) || '';
            if (!token) {
                showToast('서버가 토큰 인증을 지원하지 않습니다.', 'error');
                return;
            }
            state.reservationAuthToken = token;

            const reservation = state.reservations.find(function (r) {
                return String(r['예약ID']) === String(id);
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
                updateConfirmButton();
            }
        } else {
            showToast(res.error || '인증에 실패했습니다.', 'error');
        }
    } catch (e) {
        showLoading(false);
        showToast(formatApiError(e, '서버 연결에 실패했습니다.'), 'error');
    }
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

        const token = verifyRes.token || (verifyRes.data && verifyRes.data.token) || '';
        if (!token) {
            showToast('서버가 토큰 인증을 지원하지 않습니다.', 'error');
            return;
        }

        state.deleteTargetReservation = state.reservations.find(function (r) {
            return String(r['예약ID']) === String(id);
        }) || null;
        renderDeleteSummary();

        openModal('modalDelete');
        document.getElementById('modalDeleteConfirm').onclick = async function () {
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
                state.deleteTargetReservation = null;
                const box = document.getElementById('modalDeleteSummary');
                if (box) box.innerHTML = '';
            }
        };
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
