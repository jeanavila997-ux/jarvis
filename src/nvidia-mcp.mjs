// Cliente MCP Streamable HTTP compartilhado (proxy allowlist e cliente direto do JARVIS).
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
    return { status: r.status, session: sess, text, json: parseMcpBody(text) };
  } finally { clearTimeout(tm); }
}

export function criarSessaoUpstream({ fetchFn, upstream, timeoutMs = 15000, clientInfo = { name: 'jarvis-nvidia', version: '0.2.0' } }) {
  let session = null;
  let pronta = null;

  async function abrir() {
    const init = await mcpRpc({
      fetchFn, upstream, timeoutMs,
      body: {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo },
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
