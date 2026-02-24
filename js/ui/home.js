
import { apiGet } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';

var roomList = [];

export async function loadRoomsForHome() {
    var grid = document.getElementById('floorGrid');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>';

    try {
        var res = await apiGet('getRooms', {});
        if (res.success) {
            roomList = (res.data || []).filter(function (r) { return r['활성화'] === true; });
            _renderAndAutoSelect();
        } else {
            // 실패 시 기본 회의실 표시
            roomList = getDefaultRooms();
            _renderAndAutoSelect();
        }
    } catch (e) {
        // 오프라인 시 기본값 사용
        roomList = getDefaultRooms();
        _renderAndAutoSelect();
    }
}

function getDefaultRooms() {
    return [
        { '회의실ID': '6F', '층': '6F', '이름': '회의실', '활성화': true },
        { '회의실ID': '7F', '층': '7F', '이름': '회의실', '활성화': true },
        { '회의실ID': '8F', '층': '8F', '이름': '회의실', '활성화': true },
        { '회의실ID': '9F', '층': '9F', '이름': '회의실', '활성화': true }
    ];
}

function applyFloorFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var floor = (params.get('floor') || '').trim().toUpperCase();
    if (!floor) return;
    var card = document.querySelector('.floor-card[data-floor="' + floor + '"]');
    if (card) selectFloor(card);
}

function _renderAndAutoSelect() {
    renderFloorGrid();
    applyFloorFromUrl();
}

function renderFloorGrid() {
    var grid = document.getElementById('floorGrid');
    if (!grid) return;

    if (roomList.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--gray-text);">활성화된 회의실이 없습니다</div>';
        return;
    }

    var html = '';
    roomList.forEach(function (room) {
        html +=
            '<div class="floor-card" data-action="select-floor" data-floor="' + escapeHtml(room['층']) + '">' +
            '<div class="floor-number">' + escapeHtml(room['층']) + '</div>' +
            '<div class="floor-label">' + escapeHtml(room['이름']) + '</div>' +
            '</div>';
    });
    grid.innerHTML = html;
}

export function selectFloor(el) {
    document.querySelectorAll('.floor-card').forEach(function (c) {
        c.classList.remove('selected');
    });
    el.classList.add('selected');
    state.selectedFloor = el.dataset.floor;

    const btn = document.getElementById('btnStartReserve');
    if (btn) {
        btn.disabled = false;
        btn.textContent = state.selectedFloor + ' 회의실 예약하기';
    }
}
