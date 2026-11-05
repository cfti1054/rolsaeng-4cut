/* 롤생네컷 서비스 워커(PWA 설치 조건 충족용).
 * 정책: 해시가 붙은 정적 파일(/_next/static)과 아이콘만 캐시한다.
 * 페이지 이동·/api 요청·세션 쿠키가 걸린 응답은 가로채지 않는다(항상 네트워크로 간다).
 */
const CACHE = 'gcd-pwa-static-v1';

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon-192.png' ||
    url.pathname === '/icon-512.png' ||
    url.pathname === '/apple-icon.png' ||
    url.pathname === '/icon.png'
  );
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('gcd-pwa-static-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!isCacheable(url)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    })(),
  );
});
