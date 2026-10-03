/*
 * The service worker that retires the old one.
 *
 * The browser version of the game that used to live at this address registered a service worker
 * for the whole site, and it answers every request cache-first. Left in place it would go on
 * doing that for the build that replaced it — whose files are not named for their contents — and
 * a returning player would be served the first copy they ever fetched, for ever. A missing
 * sw.js does not remove a worker; only a newer worker can.
 *
 * So this one is deployed at the same address. It takes over at once, throws away every cache
 * the old one kept, removes itself, and reloads the pages it controlled so they are fetched
 * straight from the network. A browser that never had the old worker never registers this one:
 * nothing on the page asks for it.
 *
 * The classic version, at /classic/, registers its own worker for its own folder and is not
 * touched by any of this.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key)
      await self.registration.unregister()
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url)
    })(),
  )
})
