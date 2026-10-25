// Service worker simples: guarda os arquivos do app para abrir offline.
// Os dados financeiros NÃO passam por aqui; o Firestore tem cache próprio.
const VERSAO = "v3";
const CACHE = `financas-${VERSAO}`;
const ARQUIVOS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Só arquivos do próprio app; Firebase/Google ficam de fora.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Rede primeiro (sempre a versão mais nova), cache como reserva offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
