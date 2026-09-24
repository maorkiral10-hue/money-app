/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

// Keeps a copy of the app's files on the phone so it opens without internet.
// Only app files live here; the user's data is in IndexedDB and is never touched by this file.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', event => {
  // The feasibility-test pages (versions 1–2) send the plain string 'skipWaiting'
  if (event.data === 'skipWaiting' || event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Remove the feasibility test's file caches
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('money-app-v')).map(k => caches.delete(k)))),
  );
});
