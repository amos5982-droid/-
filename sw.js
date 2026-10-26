/* 오프라인에서도 열리도록 앱 파일을 저장해 두고, 인터넷이 되면 새 버전으로 바꿔 둔다 */
/* 같은 주소의 경제판(economy/) 저장분은 건드리지 않게, 이름이 cardnews-로 시작하는 것만 정리한다 */
var CACHE = 'cardnews-v22';
var FILES = ['./', './card-news-maker.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('cardnews-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 앱 화면(html)은 인터넷이 되면 늘 새로 받아서 바로 보여 주고, 안 될 때만 저장해 둔 것을 쓴다.
// 그림, 아이콘 같은 나머지 파일은 저장해 둔 것을 먼저 보여 주고, 뒤에서 새 파일을 받아 다음에 열 때 쓴다
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  var page = e.request.mode === 'navigate' || /(\/|\.html)$/.test(new URL(e.request.url).pathname);
  if (page) {
    e.respondWith(caches.open(CACHE).then(function (c) {
      return fetch(e.request.url, { cache: 'no-cache' }).then(function (r) {
        if (r.ok) c.put(e.request, r.clone());
        return r;
      }).catch(function () {
        return c.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); });
      });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(e.request).then(function (r) { if (r.ok) c.put(e.request, r.clone()); return r; });
      if (hit) { net.catch(function () {}); return hit; }
      return net;
    });
  }));
});
