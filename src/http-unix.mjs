// fetch() para HTTP(S) ou Unix socket (unix:///caminho/arquivo.sock).
// Usado para o Ollama e o Hermes no host, sem publicar porta e sem network_mode: host.
// Sem dependências: o socket usa só node:http; o HTTP comum usa o fetch nativo.
import http from 'node:http';

export function ehUnix(url) {
  return String(url || '').startsWith('unix://');
}

export function caminhoSocket(url) {
  if (!ehUnix(url)) return null;
  return String(url).slice('unix://'.length);
}

// URLs locais (socket ou loopback/host.docker.internal) não exigem chave de API.
export function exigeChaveOllama(url) {
  const u = String(url || '').trim();
  if (!u || ehUnix(u)) return false;
  try {
    const h = new URL(u).hostname.toLowerCase();
    return !['127.0.0.1', 'localhost', 'host.docker.internal', '::1'].includes(h);
  } catch { return true; }
}

function abortError() {
  const e = new Error('This operation was aborted');
  e.name = 'AbortError';
  return e;
}

function fetchUnix(socketPath, path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = { ...(opts.headers || {}) };
  const body = opts.body;
  const signal = opts.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const req = http.request({ socketPath, path, method, headers }, res => {
      const pedacos = [];
      res.on('data', c => pedacos.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(pedacos);
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers || {})) {
          if (v == null) continue;
          h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        }
        resolve(new Response(buf, { status: res.statusCode, statusText: res.statusMessage || '', headers: h }));
      });
    });
    req.on('error', reject);
    const onAbort = () => { req.destroy(abortError()); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    if (body) req.write(body);
    req.end();
  });
}

// path deve começar com / (ex.: /api/chat). baseUrl é http(s)://... ou unix:///path.sock
export function fetchUrl(baseUrl, path, opts = {}) {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (ehUnix(baseUrl)) return fetchUnix(caminhoSocket(baseUrl), p, opts);
  const base = String(baseUrl || '').replace(/\/$/, '');
  return fetch(`${base}${p}`, opts);
}
