import { state } from '../state.js';
import { loadRoomsForHome } from './home.js';
import { loadReservations, setReservationPasswordMode } from './reservation.js';

// ═══════════════════════════════════════════════════════
// 공통 UI 유틸리티 (배너, 모달, 토스트, 화면 전환)
// ═══════════════════════════════════════════════════════

export function navigateTo(screenId) {
    // 화면별 최신 데이터 로드
    if (screenId === 'screenHome') {
        loadRoomsForHome();
    }
    if (screenId === 'screenMyReservations') {
        loadReservations();
    }
    showScreen(screenId);
}

export function resetAndGoHome() {
    state.reservationAuthToken = null;
    state.editReservationId = null;
    state.editOriginalReservation = null;
    state.selectedFloor = null;
    state.selectedDate = null;
    state.selectedStartTime = null;
    state.selectedEndTime = null;
    state.deleteTargetReservation = null;

    const btn = document.getElementById('btnStartReserve');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '층을 선택해주세요';
    }

    setReservationPasswordMode(false);
    const title = document.getElementById('reserveTitle');
    if (title) title.textContent = '예약하기';
    const sub = document.getElementById('reserveSubtitle');
    if (sub) sub.textContent = '회의실과 시간을 선택해주세요';

    navigateTo('screenHome');
}

export function initNetworkBanner() {
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
// 서비스 워커
// ═══════════════════════════════════════════════════════
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker) return;

    var hasControllerChangeReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (hasControllerChangeReloaded) return;
        hasControllerChangeReloaded = true;
        window.location.reload();
    });

    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then(function (registration) {
        function handleInstallingWorker(worker) {
            if (!worker) return;
            worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    worker.postMessage({ type: 'SKIP_WAITING' });
                }
            });
        }

        handleInstallingWorker(registration.installing);

        registration.addEventListener('updatefound', function () {
            handleInstallingWorker(registration.installing);
        });

        setInterval(function () {
            registration.update().catch(function () { });
        }, 60 * 1000);
    }).catch(function () { });
}

// ═══════════════════════════════════════════════════════
// 모달
// ═══════════════════════════════════════════════════════
export function openModal(id) {
    const overlay = document.getElementById(id);
    if (overlay) {
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }
}

export function closeModal(id) {
    const overlay = document.getElementById(id);
    if (overlay) {
        overlay.classList.remove('show');
        document.body.style.overflow = '';
    }
}

export function initModalListeners() {
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay) {
                overlay.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
    });
}

// ═══════════════════════════════════════════════════════
// 토스트 메시지
// ═══════════════════════════════════════════════════════
export function showToast(message, type) {
    type = type || '';
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(function () {
        toast.classList.add('show');
    });

    setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () {
            if (toast.parentNode) container.removeChild(toast);
        }, 300);
    }, 2500);
}

// ═══════════════════════════════════════════════════════
// 로딩
// ═══════════════════════════════════════════════════════
export function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;
    if (show) {
        overlay.classList.add('show');
    } else {
        overlay.classList.remove('show');
    }
}

// ═══════════════════════════════════════════════════════
// 화면 전환
// ═══════════════════════════════════════════════════════
export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
        s.classList.remove('active', 'visible');
    });
    const target = document.getElementById(id);
    if (target) {
        target.classList.add('active');
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                target.classList.add('visible');
            });
        });
        window.scrollTo(0, 0);
    }
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

export function initInstallBanner() {
    if (isInStandaloneMode()) return;

    var dismissed = localStorage.getItem('installBannerDismissed');
    if (dismissed) {
        var dismissedTime = parseInt(dismissed, 10);
        if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) return;
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredInstallPrompt = e;
        showInstallBanner();
    });

    if (isIos()) {
        showInstallBanner();
    }

    window.addEventListener('appinstalled', function () {
        const banner = document.getElementById('installBanner');
        if (banner) banner.classList.remove('show');
        deferredInstallPrompt = null;
        showToast('앱이 설치되었습니다!', 'success');
    });
}

function showInstallBanner() {
    var banner = document.getElementById('installBanner');
    if (banner) banner.classList.add('show');
}

export function handleInstallClick() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function (result) {
            if (result.outcome === 'accepted') {
                const banner = document.getElementById('installBanner');
                if (banner) banner.classList.remove('show');
            }
            deferredInstallPrompt = null;
        });
    } else if (isIos()) {
        openModal('modalIosGuide');
    }
}

export function dismissInstallBanner() {
    var banner = document.getElementById('installBanner');
    if (banner) banner.classList.remove('show');
    localStorage.setItem('installBannerDismissed', String(Date.now()));
}
