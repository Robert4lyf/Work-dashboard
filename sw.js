// Dashboard service worker: makes the app installable and usable offline.
// VERSION is stamped automatically by .github/workflows/pages.yml on each deploy.
// If you deploy from a branch instead, bump it by hand whenever you upload changed files.
const VERSION = 'dashboard-v4';
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.0/dist/umd/supabase.js';
const APP = ['state', 'tree', 'merge', 'header', 'today', 'inbox', 'focus', 'projects', 'history', 'sync', 'board', 'events']
  .map(n => `./js/${n}.js`);
const SHELL = ['./', './index.html', './config.js', './styles.css', './manifest.webmanifest', ...APP,
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', SUPABASE_JS];

try { importScripts('./config.js'); } catch (e) {}
let apiOrigin = '';
try { apiOrigin = new URL(self.COCKPIT_CONFIG.supabaseUrl).origin; } catch (e) {}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => caches.open(VERSION).then(c => c.put(req, res));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (apiOrigin && url.origin === apiOrigin) return;          // sync traffic: always live
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // The app itself (page, scripts, styles, config): network first so updates arrive
  // together, cache when offline
  if (req.mode === 'navigate' || (url.origin === self.location.origin && /\.(js|css)$/.test(url.pathname))) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) put(req.mode === 'navigate' ? './index.html' : req, res.clone());
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req)));
    return;
  }
  // Everything else (icons, fonts, library): cache first
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') put(req, res.clone());
    return res;
  })));
});

// Tapping a timer notification brings the app back to the front.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
