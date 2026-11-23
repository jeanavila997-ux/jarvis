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

// Nome de um rótulo só (ollama) é DNS interno do Docker, não a nuvem ollama.com.
function hostnameLocal(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (['localhost', 'host.docker.internal', '::1'].includes(h)) return true;
  if (!h.includes('.')) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const m = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

// URLs locais (socket, loopback, DNS do compose ou IP privado) não exigem chave de API.
// https://ollama.com continua exigindo: tem ponto e não é rede privada.
export function exigeChaveOllama(url) {
  const u = String(url || '').trim();
  if (!u || ehUnix(u)) return false;
  try { return !hostnameLocal(new URL(u).hostname); }
  catch { return true; }
}

// Saudação local fica curta. A resposta completa não herda esse teto de 300:
// na RTX 3050 o limite seguro é o num_ctx, senão explicação e código saem cortados.
export function opcoesChatLocal({ curto = false, think, numCtx = 4096, numPredict } = {}) {
  const ctx = Number(numCtx);
  const options = { temperature: 0.4, num_ctx: Number.isFinite(ctx) && ctx > 0 ? ctx : 4096 };
  if (curto) options.num_predict = 300;
  else if (numPredict != null && numPredict !== '') {
    const n = Number(numPredict);
    if (Number.isFinite(n) && n > 0) options.num_predict = n;
  }
  const out = { keepAlive: '30m', options };
  if (think !== undefined) out.think = think;
  return out;
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
