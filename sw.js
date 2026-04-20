self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let data = { title: '⏰ Hatırlatma', body: 'Bir görevinizin zamanı geldi!' };
  try { data = { ...data, ...e.data?.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/todo-app/icon-192.png',
      badge:   '/todo-app/icon-192.png',
      vibrate: [200, 100, 200],
      data:    { url: 'https://sergennunsal86.github.io/todo-app/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url ?? '/todo-app/'));
});
