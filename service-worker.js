/**
 * J동 회의실 예약 PWA - Service Worker
 * 오프라인 캐싱 및 네트워크 전략 관리
 */

const CACHE_NAME = 'jdong-reservation-v6';
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

// ─── 요청 가로채기 (네트워크 우선 전략) ──────────────────
self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Google Apps Script API 요청은 항상 네트워크
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('script.googleusercontent.com')) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response(
          JSON.stringify({ success: false, error: '오프라인 상태입니다.' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  if (!isCacheableStaticRequest(event.request, url)) {
    return;
  }

  // 정적 자산: 캐시 우선, 네트워크 폴백
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // 백그라운드에서 캐시 업데이트
        fetch(event.request).then(function(networkResponse) {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(function() {});

        return cachedResponse;
      }

      return fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      });
    })
  );
});
