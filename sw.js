// sw.js
// No hay ningún Service Worker "real" en este proyecto (no se usa modo
// offline por ahora). Este archivo existe únicamente para reemplazar y
// eliminar cualquier Service Worker viejo que haya quedado cacheado en
// el navegador de un visitante desde una versión anterior del sitio
// (por ejemplo de un deploy manual anterior a conectar el repo a GitHub).
//
// Al detectar este archivo como "nuevo" (byte distinto al que tenía
// cacheado), el navegador lo instala, lo activa de inmediato (skipWaiting),
// borra TODAS las cachés que hubiera y se desregistra a sí mismo. A partir
// de ahí el sitio vuelve a pedir todo directo a la red, sin intermediarios.
//
// Si en el futuro se quiere agregar soporte offline real, hay que
// reescribir este archivo con una estrategia de caché versionada
// (ej: un CACHE_NAME con el número de versión, que se borra en 'activate'
// cada vez que cambia) para no volver a caer en este mismo problema.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();

      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
