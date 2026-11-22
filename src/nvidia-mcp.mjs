// Cliente MCP Streamable HTTP compartilhado (proxy allowlist e cliente direto do JARVIS).
import http from 'node:http';
import https from 'node:https';
export function parseMcpBody(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const datas = [];
  for (const line of String(text).split(/\n/)) {
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (d && d !== '[DONE]') {
        try { datas.push(JSON.parse(d)); } catch {}
      }
    }
  }
  return datas.length ? datas[datas.length - 1] : null;
}

async function mcpRpcNode(upstream, { method, headers, body, timeoutMs, session }) {
  const u = new URL(upstream);
  const lib = u.protocol === 'https:' ? https : http;
  const payload = method === 'POST' ? (body ?? '') : null;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      headers,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const sess = res.headers['mcp-session-id'] || session || null;
        resolve({ status: res.statusCode || 0, session: sess, text, json: parseMcpBody(text) });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('tempo esgotado')); });
    req.on('error', reject);
    if (payload != null) req.write(payload);
    req.end();
  });
}

export async function mcpRpc({ fetchFn, upstream, session, body, method = 'POST', timeoutMs = 15000, headersExtra = {} }) {
  const headers = { accept: 'application/json, text/event-stream', ...headersExtra };
  if (method === 'POST') headers['content-type'] = 'application/json';
  if (session) headers['mcp-session-id'] = session;
  const payload = method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined;
  const precisaHost = Boolean(headers.Host || headers.host);
  if (precisaHost) {
    return mcpRpcNode(upstream, { method, headers, body: payload, timeoutMs, session });
  }
  const c = new AbortController(); const tm = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetchFn(upstream, {
      method,
      headers,
      body: payload,
      signal: c.signal,
    });
    const text = await r.text();
    const sess = r.headers.get('mcp-session-id') || session || null;
    return { status: r.status, session: sess, text, json: parseMcpBody(text) };
  } finally { clearTimeout(tm); }
}

export function criarSessaoUpstream({
  fetchFn,
  upstream,
  timeoutMs = 15000,
  clientInfo = { name: 'jarvis-nvidia', version: '0.2.0' },
  headersExtra = {},
  nomeErro = 'nvidia-app',
  exigirSessao = true,
} = {}) {
  let session = null;
  let pronta = null;

  async function abrir() {
    const init = await mcpRpc({
      fetchFn, upstream, timeoutMs, headersExtra,
      body: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo },
      },
    });
    if (init.status >= 300 || init.json?.error) throw new Error(`initialize do ${nomeErro} falhou`);
    session = init.session || init.json?.result?.sessionId || null;
    if (exigirSessao && !session) throw new Error(`initialize do ${nomeErro} falhou`);
    const n = await mcpRpc({ fetchFn, upstream, session, timeoutMs, headersExtra, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    if (n.status >= 300) throw new Error('notifications/initialized falhou');
    return session;
  }

  async function garantir() {
    if (!pronta) pronta = abrir().catch(e => { pronta = null; session = null; throw e; });
    return pronta;
  }

  async function chamar(body) {
    await garantir();
    const r = await mcpRpc({ fetchFn, upstream, session, timeoutMs, headersExtra, body });
    if (r.status === 404 || r.status === 400) {
      session = null; pronta = null;
      await garantir();
      return mcpRpc({ fetchFn, upstream, session, timeoutMs, headersExtra, body });
    }
    return r;
  }

  async function fechar() {
    if (!session) return;
    try { await mcpRpc({ fetchFn, upstream, session, method: 'DELETE', timeoutMs: 5000, body: '', headersExtra }); } catch {}
    session = null; pronta = null;
  }

  return { chamar, fechar, garantir };
}
