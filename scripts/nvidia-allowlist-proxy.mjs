#!/usr/bin/env node
// Proxy allowlist do nvidia-app. Só encaminha ferramentas de LEITURA.
// Bind padrão: 127.0.0.1 (recusa 0.0.0.0, :: e *). Exige NVIDIA_PROXY_TOKEN.
// Upstream padrão: http://127.0.0.1:13508/mcp (túnel reverso no loopback da VPS, quando existir).
// Este arquivo não abre túnel nem porta pública. Não rode com bind público.
import http from 'node:http';
import { FERRAMENTAS_LEITURA } from '../src/nvidia.mjs';

const LEITURA = new Set(FERRAMENTAS_LEITURA);

export function enderecoPermitido(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h || h === '0.0.0.0' || h === '::' || h === '::0' || h === '*' || h === '[::]') return false;
  if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return true;
  // Redes privadas: para um bind futuro no gateway do docker, ainda não ativado.
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const m = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return false;
}

export async function mcpRpc({ fetchFn, upstream, session, body, method = 'POST', timeoutMs = 15000 }) {
  const headers = { accept: 'application/json, text/event-stream' };
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (session) headers['mcp-session-id'] = session;
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetchFn(upstream, {
      method,
      headers,
      body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: c.signal,
    });
    const text = await r.text();
    const sess = r.headers.get('mcp-session-id') || session || null;
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = null; }
    }
    return { status: r.status, session: sess, text, json };
  } finally { clearTimeout(tm); }
}

export function criarSessaoUpstream({ fetchFn, upstream, timeoutMs = 15000 }) {
  let session = null;
  let pronta = null;

  async function abrir() {
    const init = await mcpRpc({
      fetchFn, upstream, timeoutMs,
      body: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'jarvis-nvidia-allowlist', version: '0.1.0' } },
      },
    });
    if (init.status >= 300 || !init.session) throw new Error('initialize do nvidia-app falhou');
    session = init.session;
    const n = await mcpRpc({ fetchFn, upstream, session, timeoutMs, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    if (n.status >= 300) throw new Error('notifications/initialized falhou');
    return session;
  }

  async function garantir() {
    if (!pronta) pronta = abrir().catch(e => { pronta = null; session = null; throw e; });
    return pronta;
  }

  async function chamar(body) {
    await garantir();
    const r = await mcpRpc({ fetchFn, upstream, session, timeoutMs, body });
    if (r.status === 404 || r.status === 400) {
      session = null; pronta = null;
      await garantir();
      return mcpRpc({ fetchFn, upstream, session, timeoutMs, body });
    }
    return r;
  }

  async function fechar() {
    if (!session) return;
    try { await mcpRpc({ fetchFn, upstream, session, method: 'DELETE', timeoutMs: 5000, body: '' }); } catch {}
    session = null; pronta = null;
  }

  return { chamar, fechar, garantir };
}

export function classificarFerramenta(meta, nome) {
  const hint = meta?.annotations?.readOnlyHint;
  if (hint === true) return 'LEITURA';
  if (hint === false) return 'ESCRITA';
  return LEITURA.has(nome) ? 'LEITURA' : 'ESCRITA';
}

export function deveEncaminhar(nome, meta) {
  if (!LEITURA.has(nome)) return false;
  if (meta && meta.annotations && meta.annotations.readOnlyHint === false) return false;
  return true;
}

function corpoJson(req) {
  return new Promise((resolve, reject) => {
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(pedacos).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function enviar(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export function criarProxy({
  host = '127.0.0.1',
  port = 13509,
  token,
  upstream = 'http://127.0.0.1:13508/mcp',
  fetchFn = fetch,
  timeoutMs = 15000,
} = {}) {
  if (!token) throw new Error('NVIDIA_PROXY_TOKEN é obrigatório');
  if (!enderecoPermitido(host)) throw new Error(`bind recusado: ${host} (só 127.0.0.1, localhost ou IP privado)`);

  const sessao = criarSessaoUpstream({ fetchFn, upstream, timeoutMs });
  let idRpc = 10;

  async function ferramentasAoVivo() {
    const r = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
    const tools = r.json?.result?.tools || [];
    return tools.filter(t => deveEncaminhar(t.name, t)).map(t => ({
      name: t.name,
      description: t.description,
      classe: 'LEITURA',
      inputSchema: t.inputSchema,
    }));
  }

  async function tratar(req, res) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${token}`) return enviar(res, 401, { ok: false, erro: 'token recusado' });
    const url = new URL(req.url, 'http://local');

    if (req.method === 'GET' && url.pathname === '/saude') {
      try {
        const ferramentas = await ferramentasAoVivo();
        return enviar(res, 200, { ok: true, upstream: true, ferramentas: ferramentas.map(f => f.name) });
      } catch (e) {
        return enviar(res, 200, { ok: false, upstream: false, motivo: 'upstream-indisponivel' });
      }
    }

    if (req.method === 'GET' && url.pathname === '/ferramentas') {
      try {
        return enviar(res, 200, { ferramentas: await ferramentasAoVivo() });
      } catch (e) {
        return enviar(res, 502, { erro: 'upstream indisponível' });
      }
    }

    if (req.method === 'POST' && url.pathname === '/ferramenta') {
      let body;
      try { body = await corpoJson(req); } catch (e) { return enviar(res, e.status || 400, { erro: e.message }); }
      const nome = body.name;
      const args = body.arguments || {};
      if (!nome) return enviar(res, 400, { erro: 'name é obrigatório' });
      if (!LEITURA.has(nome)) return enviar(res, 403, { erro: `ferramenta '${nome}' é ESCRITA ou desconhecida; o proxy recusou` });
      try {
        const lista = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
        const meta = (lista.json?.result?.tools || []).find(t => t.name === nome);
        if (!deveEncaminhar(nome, meta)) return enviar(res, 403, { erro: `ferramenta '${nome}' recusada pela allowlist` });
        const r = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/call', params: { name: nome, arguments: args } });
        if (r.json?.error) return enviar(res, 502, { erro: r.json.error.message || r.json.error });
        return enviar(res, 200, { name: nome, result: r.json?.result ?? null });
      } catch (e) {
        return enviar(res, 502, { erro: 'upstream indisponível' });
      }
    }

    return enviar(res, 404, { erro: 'rota inexistente' });
  }

  const server = http.createServer((req, res) => {
    tratar(req, res).catch(() => { if (!res.headersSent) enviar(res, 500, { erro: 'falha interna' }); });
  });

  function escutar() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve(server.address()));
    });
  }

  async function fechar() {
    await sessao.fechar();
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }

  return { server, escutar, fechar, sessao };
}

const isMain = process.argv[1] && process.argv[1].endsWith('nvidia-allowlist-proxy.mjs');
if (isMain) {
  const host = process.env.NVIDIA_PROXY_HOST || '127.0.0.1';
  const port = Number(process.env.NVIDIA_PROXY_PORT || 13509);
  const token = process.env.NVIDIA_PROXY_TOKEN;
  const upstream = process.env.NVIDIA_MCP_UPSTREAM || 'http://127.0.0.1:13508/mcp';
  if (!token) {
    console.error('Defina NVIDIA_PROXY_TOKEN. Abortando (nenhuma porta aberta).');
    process.exit(1);
  }
  const proxy = criarProxy({ host, port, token, upstream });
  proxy.escutar().then(addr => {
    console.log(`proxy allowlist nvidia-app em ${addr.address}:${addr.port} (só LEITURA)`);
  }).catch(e => {
    console.error(e.message || e);
    process.exit(1);
  });
  const parar = () => { proxy.fechar().finally(() => process.exit(0)); };
  process.on('SIGINT', parar);
  process.on('SIGTERM', parar);
}
