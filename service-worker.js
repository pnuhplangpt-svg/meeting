/**
 * J동 회의실 예약 PWA - Service Worker
 * 오프라인 캐싱 및 네트워크 전략 관리
 */

const CACHE_NAME = 'jdong-reservation-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './app.js',
  './qrcode.min.js'
];

const STATIC_CACHE_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  '/app.js',
  '/qrcode.min.js'
]);


function isCacheableStaticRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.search) return false;
  return STATIC_CACHE_PATHS.has(url.pathname);
}

// ─── 설치 ───────────────────────────────────────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ─── 활성화 (이전 캐시 정리) ─────────────────────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});



self.addEventListener('message', function(event) {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') {
    return Promise.resolve(response);
  }
  return caches.open(CACHE_NAME).then(function(cache) {
    cache.put(request, response.clone());
    return response;
  });
}

function networkFirst(request) {
  return fetch(request).then(function(response) {
    return cacheResponse(request, response);
  }).catch(function() {
    return caches.match(request).then(function(cachedResponse) {
      if (cachedResponse) return cachedResponse;
      throw new Error('Network unavailable and cache miss');
    });
  });
}

// ─── 요청 가로채기 (네트워크 우선 전략) ──────────────────
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Google Apps Script API 요청은 SW가 절대 가로채지 않음
  // (브라우저 기본 네트워크 스택으로 전달하여 CORS/리다이렉트 오류를 명확히 유지)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  if (!isCacheableStaticRequest(event.request, url)) {
    return;
  }

  // 정적 자산: 네트워크 우선(최신 코드 반영), 실패 시 캐시 폴백
  event.respondWith(networkFirst(event.request));
});
