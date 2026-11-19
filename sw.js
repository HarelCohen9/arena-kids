const C='arena-mwnp9rmq';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==C).map(n=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);const page=r.mode==='navigate'||u.pathname.endsWith('.html');
 e.respondWith(caches.open(C).then(c=>page?fetch(r).then(res=>{c.put(r,res.clone());return res;}).catch(()=>c.match(r)):c.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==='opaque')c.put(r,res.clone());return res;}))));});
