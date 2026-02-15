
import { apiGet } from '../api.js';
import { escapeHtml, formatDate, normalizeTime } from '../utils.js';

// ═══════════════════════════════════════════════════════
// 디스플레이 모드 (입구 패드용)
// ═══════════════════════════════════════════════════════
var displayFloor = null;
var displayTimer = null;
var displayClockTimer = null;
var displayWakeLock = null;
var DISPLAY_REFRESH_INTERVAL = 60000; // 기본 60초
var DISPLAY_REFRESH_MAX_INTERVAL = 5 * 60000; // 실패 시 최대 5분 backoff
var displayFailureCount = 0;
var displayRoomNameCache = null;
var displayRoomNameCacheAt = 0;
var DISPLAY_ROOMS_CACHE_TTL = 10 * 60 * 1000; // 10분

export function initDisplayMode() {
    var params = new URLSearchParams(window.location.search);
    var floor = (params.get('display') || '').trim().toUpperCase();
    if (!floor) return false;

    displayFloor = floor;

    // 모든 일반 화면 숨기기
    document.querySelectorAll('.screen').forEach(function (s) {
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

    // 첫 데이터 로드 + 적응형 주기 갱신
    scheduleNextDisplayLoad(0);

    // 화면 꺼짐 방지
    requestWakeLock();

    // 전체화면 진입 안내 오버레이 (비 fullscreen 상태일 때만)
    showFullscreenOverlay();

    // 전체화면 상태 변경 감지 → 아이콘 토글
    document.addEventListener('fullscreenchange', updateFullscreenIcon);

    // 탭 비활성→활성 복귀 시 즉시 갱신 + Wake Lock 재요청
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden && displayFloor) {
            scheduleNextDisplayLoad(0);
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

function getDisplayBackoffIntervalMs() {
    if (displayFailureCount <= 0) return DISPLAY_REFRESH_INTERVAL;
    var next = DISPLAY_REFRESH_INTERVAL * Math.pow(2, Math.min(displayFailureCount, 4));
    return Math.min(DISPLAY_REFRESH_MAX_INTERVAL, next);
}

function scheduleNextDisplayLoad(delayMs) {
    if (displayTimer) {
        clearTimeout(displayTimer);
    }
    displayTimer = setTimeout(loadDisplayData, Math.max(0, delayMs || 0));
}

function renderDisplayUnavailable(message) {
    var status = document.getElementById('displayStatus');
    if (!status) return;
    status.className = 'display-panel-status state-unavailable';
    status.innerHTML =
        '<span class="dp-state-badge" style="background:#fff3cd;color:#8a6d3b;border-color:#ffe49b;">● 확인 필요</span>' +
        '<div class="dp-state-text" style="color:#8a6d3b;">' + escapeHtml(message) + '</div>' +
        '<div class="dp-next" style="margin-top:12px;">관리자에서 회의실 활성 상태를 확인해주세요.</div>';

    var timeline = document.getElementById('displayTimeline');
    if (timeline) {
        timeline.innerHTML = '<div class="ds-row empty" style="min-height:64px"><div class="ds-row-time">-</div><div class="ds-row-content">표시할 일정이 없습니다.</div></div>';
    }
}

export async function loadDisplayData() {
    var today = formatDate(new Date());
    var nextIntervalMs = DISPLAY_REFRESH_INTERVAL;

    try {
        var res = await apiGet('getReservations', {
            date: today,
            floor: displayFloor
        });

        // 층 이름 캐시(10분 TTL) + 활성 여부 검증
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
                var room = displayRoomNameCache.find(function (r) {
                    return String(r['층']) === String(displayFloor);
                });
                if (room) {
                    document.getElementById('displayFloorName').textContent =
                        room['층'] + ' ' + room['이름'];
                } else {
                    renderDisplayUnavailable(displayFloor + ' 회의실이 비활성 상태이거나 존재하지 않습니다.');
                }
            }
        } catch (e) { }

        if (res.success) {
            var reservations = (res.data || []).map(function (r) {
                r['시작시간'] = normalizeTime(r['시작시간']);
                r['종료시간'] = normalizeTime(r['종료시간']);
                return r;
            }).sort(function (a, b) {
                return a['시작시간'] < b['시작시간'] ? -1 : 1;
            });

            renderDisplayStatus(reservations);
            renderDisplaySchedule(reservations);
        }

        displayFailureCount = 0;
        nextIntervalMs = getDisplayBackoffIntervalMs();

        var now = new Date();
        document.getElementById('displayRefreshInfo').textContent =
            '마지막 갱신 ' + String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0') + ':' +
            String(now.getSeconds()).padStart(2, '0') +
            ' · 자동 갱신 ' + Math.round(nextIntervalMs / 1000) + '초';

    } catch (e) {
        displayFailureCount += 1;
        nextIntervalMs = getDisplayBackoffIntervalMs();
        document.getElementById('displayRefreshInfo').textContent =
            '서버 연결 실패 · ' + Math.round(nextIntervalMs / 1000) + '초 후 재시도';
    } finally {
        scheduleNextDisplayLoad(nextIntervalMs);
    }
}

function renderDisplayStatus(reservations) {
    var container = document.getElementById('displayStatus');
    var now = new Date();
    var currentTime = String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0');

    var current = null;
    for (var i = 0; i < reservations.length; i++) {
        if (currentTime >= reservations[i]['시작시간'] && currentTime < reservations[i]['종료시간']) {
            current = reservations[i];
            break;
        }
    }

    var next = null;
    for (var j = 0; j < reservations.length; j++) {
        if (reservations[j]['시작시간'] > currentTime) {
            next = reservations[j];
            break;
        }
    }

    container.className = 'display-panel-status';

    var html = '';

    if (current) {
        container.classList.add('state-inuse');

        html +=
            '<span class="dp-state-badge inuse">● 사용 중</span>' +
            '<div class="dp-time-range">현재 시간 ' + escapeHtml(currentTime) + '</div>' +
            '<div class="dp-state-text inuse">사용 중</div>' +
            '<div class="dp-meeting-info">' +
            '<div class="dp-field"><span class="k">팀명</span><span class="v dp-meeting-team">' + escapeHtml(current['팀명']) + '</span></div>' +
            '<div class="dp-field"><span class="k">예약자</span><span class="v dp-meeting-user">' + escapeHtml(current['예약자']) + '</span></div>' +
            '<div class="dp-field"><span class="k">시간</span><span class="v dp-meeting-time">' + escapeHtml(current['시작시간']) + ' ~ ' + escapeHtml(current['종료시간']) + '</span></div>' +
            '</div>';

        if (next) {
            var diff = parseTimeToMinutes(next['시작시간']) - parseTimeToMinutes(currentTime);
            html +=
                '<div class="dp-next">' +
                '<div class="dp-next-title">다음 예약</div>' +
                '<strong>' + escapeHtml(next['시작시간']) + ' ~ ' + escapeHtml(next['종료시간']) + '</strong><br>' +
                escapeHtml(next['팀명']) + ' · ' + escapeHtml(formatDiffLabel(diff)) +
                '</div>';
        } else {
            html +=
                '<div class="dp-next">' +
                '<div class="dp-next-title">다음 예약</div>' +
                '오늘 남은 예약이 없습니다.' +
                '</div>';
        }
    } else if (next) {
        var diffMin = parseTimeToMinutes(next['시작시간']) - parseTimeToMinutes(currentTime);

        if (diffMin <= 30) {
            container.classList.add('state-soon');
            html +=
                '<span class="dp-state-badge soon">● 곧 시작</span>' +
                '<div class="dp-time-range">현재 시간 ' + escapeHtml(currentTime) + '</div>' +
                '<div class="dp-state-text" style="color:#f5a623;">곧 시작</div>' +
                '<div class="dp-meeting-info">' +
                '<div class="dp-field"><span class="k">팀명</span><span class="v dp-meeting-team">' + escapeHtml(next['팀명']) + '</span></div>' +
                '<div class="dp-field"><span class="k">예약자</span><span class="v dp-meeting-user">' + escapeHtml(next['예약자']) + '</span></div>' +
                '<div class="dp-field"><span class="k">시간</span><span class="v dp-meeting-time">' + escapeHtml(next['시작시간']) + ' ~ ' + escapeHtml(next['종료시간']) + ' (' + diffMin + '분 후)</span></div>' +
                '</div>';
        } else {
            container.classList.add('state-available');
            html +=
                '<span class="dp-state-badge available">● 사용 가능</span>' +
                '<div class="dp-time-range">현재 시간 ' + escapeHtml(currentTime) + '</div>' +
                '<div class="dp-state-text available">사용 가능</div>' +
                '<div class="dp-next" style="margin-top:16px;">' +
                '<div class="dp-next-title">다음 예약</div>' +
                '<strong>' + escapeHtml(next['시작시간']) + ' ~ ' + escapeHtml(next['종료시간']) + '</strong><br>' +
                escapeHtml(next['팀명']) + ' · ' + escapeHtml(formatDiffLabel(diffMin)) +
                '</div>';
        }
    } else {
        container.classList.add('state-available');
        html +=
            '<span class="dp-state-badge available">● 사용 가능</span>' +
            '<div class="dp-time-range">현재 시간 ' + escapeHtml(currentTime) + '</div>' +
            '<div class="dp-state-text available">사용 가능</div>' +
            '<div class="dp-next" style="margin-top:16px;">' +
            '<div class="dp-next-title">오늘 일정</div>' +
            '오늘 남은 예약이 없습니다' +
            '</div>';
    }

    var qrUrl = window.location.origin + window.location.pathname.replace(/\?.*$/, '');

    html +=
        '<div class="dp-qr-area">' +
        '<div id="dpQrCode" class="dp-qr-img"></div>' +
        '<div class="dp-qr-text">QR 스캔하여 예약하기</div>' +
        '</div>';

    container.innerHTML = html;

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

function formatDiffLabel(diffMin) {
    if (diffMin <= 0) return '곧 시작';
    if (diffMin >= 60) {
        return Math.floor(diffMin / 60) + '시간 ' + (diffMin % 60) + '분 후';
    }
    return diffMin + '분 후';
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

    var header = document.querySelector('.ds-timeline-header');
    if (header) {
        header.textContent = '오늘 일정 · ' + String((reservations || []).length) + '건';
    }

    var OPEN_MIN = 7 * 60;
    var CLOSE_MIN = 21 * 60;

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();

    var sortedReservations = (reservations || []).slice().sort(function (a, b) {
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
        // Wake Lock 실패 시 무시
    }
}

export function toggleDisplayFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () { });
    } else {
        document.exitFullscreen().catch(function () { });
    }
}

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

function showFullscreenOverlay() {
    if (document.fullscreenElement) return;
    if (window.matchMedia('(display-mode: fullscreen)').matches) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    var overlay = document.createElement('div');
    overlay.className = 'display-fs-overlay';
    overlay.innerHTML =
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
        '<div class="fs-text">화면을 터치하면 전체화면으로 전환됩니다</div>' +
        '<div class="fs-sub">헤더의 버튼으로 언제든 전환할 수 있습니다</div>';

    overlay.addEventListener('click', function () {
        document.documentElement.requestFullscreen().catch(function () { });
        overlay.remove();
    });

    setTimeout(function () {
        if (overlay.parentNode) {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.5s';
            setTimeout(function () { overlay.remove(); }, 500);
        }
    }, 5000);

    document.body.appendChild(overlay);
}
