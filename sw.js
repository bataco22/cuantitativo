const CACHE="quant-centro-v61-20260806";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./actualizar.html"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener("activate",event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener("fetch",event=>{
  if(event.request.url.includes("binance.vision")) return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put("./index.html",copy));return response;}).catch(()=>caches.match("./index.html")));
    return;
  }
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return response;}).catch(()=>caches.match(event.request)));
});
