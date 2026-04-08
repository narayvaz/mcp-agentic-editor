self.addEventListener('install', (event) => {
  console.log('SW: Install event');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('SW: Activate event');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Simple fetch handler to satisfy PWA requirements
  event.respondWith(fetch(event.request));
});
