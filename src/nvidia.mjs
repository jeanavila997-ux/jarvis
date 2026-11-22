// Cliente do proxy allowlist do nvidia-app (PC do Jean). DESLIGADO por padrão (NVIDIA_APP=1 liga).
// Fala só com o proxy (URL + token), nunca direto com o MCP. Só ferramentas de LEITURA.
// Cai quando o PC desliga ou o túnel não está no ar. Nunca loga o token.
import { criarSessaoUpstream } from './nvidia-mcp.mjs';
export const FERRAMENTAS_LEITURA = Object.freeze([
  'nvapp_overlay_get_status',
  'nvapp_overlay_get_current_game_info',
  'nvapp_client_get_applications',
  'nvapp_client_get_driver_status',
  'nvapp_client_get_driver_release_notes',
  'nvapp_client_get_laptop_features',
]);

const LEITURA = new Set(FERRAMENTAS_LEITURA);

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


export function criarClienteNvidia({
  ligada = false,
  url = '',
  token = '',
  timeoutMs = 15000,
  cacheMs = 30000,
  agora = () => Date.now(),
  fetchFn = fetch,
} = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const ativa = Boolean(ligada && base && token);
  let saudeCache = { ate: 0, valor: null };

  function cabecalhos() {
    return { authorization: `Bearer ${token}`, accept: 'application/json' };
  }

  async function erroHttp(r) {
    let msg = await r.text().catch(() => '');
    try { const j = JSON.parse(msg); msg = j.erro || j.error?.message || j.error || msg; } catch {}
    msg = String(msg).slice(0, 200);
    if (r.status === 401) return new Error('nvidia-app: token recusado (401)');
    if (r.status === 403) return new Error(`nvidia-app: ferramenta recusada pelo proxy (403) ${msg}`);
    if (r.status === 502 || r.status === 503) return new Error(`nvidia-app: upstream indisponível (${r.status}) ${msg}`);
    return new Error(`nvidia-app respondeu HTTP ${r.status}: ${msg}`);
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado' };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    let valor = { ok: false, motivo: 'indisponivel' };
    try {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 5000);
      const r = await fetchFn(`${base}/saude`, { headers: cabecalhos(), signal: c.signal }).finally(() => clearTimeout(tm));
      if (r.status === 401) valor = { ok: false, motivo: 'token-recusado' };
      else if (!r.ok) valor = { ok: false, motivo: `http-${r.status}` };
      else {
        const j = await r.json().catch(() => ({}));
        valor = { ok: j.ok === true && j.upstream === true, motivo: j.ok && j.upstream ? 'ok' : (j.motivo || 'upstream-indisponivel'), ferramentas: j.ferramentas };
      }
    } catch { valor = { ok: false, motivo: 'indisponivel' }; }
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  async function listar() {
    if (!ativa) throw new Error('nvidia-app: desligado');
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetchFn(`${base}/ferramentas`, { headers: cabecalhos(), signal: c.signal });
      if (!r.ok) throw await erroHttp(r);
      const j = await r.json();
      return Array.isArray(j.ferramentas) ? j.ferramentas : [];
    } finally { clearTimeout(tm); }
  }

  async function chamar(nome, argumentos = {}) {
    if (!ativa) throw new Error('nvidia-app: desligado');
    if (!LEITURA.has(nome)) throw new Error(`nvidia-app: '${nome}' não é LEITURA e o cliente recusou`);
    const c = new AbortController(); const tm = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetchFn(`${base}/ferramenta`, {
        method: 'POST',
        headers: { ...cabecalhos(), 'content-type': 'application/json' },
        signal: c.signal,
        body: JSON.stringify({ name: nome, arguments: argumentos || {} }),
      });
      if (!r.ok) throw await erroHttp(r);
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('nvidia-app: tempo esgotado');
      throw e;
    } finally { clearTimeout(tm); }
  }

  return { ativa, saudavel, listar, chamar, leitura: FERRAMENTAS_LEITURA };
}


// Cliente direto do MCP (JARVIS local no PC). Só LEITURA, fail-closed, sem token.
// Liga com NVIDIA_APP=1 e NVIDIA_MCP_URL (ex.: http://host.docker.internal:13508/mcp).
export function criarClienteNvidiaMcp({
  ligada = false,
  url = '',
  timeoutMs = 15000,
  cacheMs = 30000,
  agora = () => Date.now(),
  fetchFn = fetch,
} = {}) {
  const base = String(url || '').trim();
  const ativa = Boolean(ligada && base);
  const sessao = ativa ? criarSessaoUpstream({ fetchFn, upstream: base, timeoutMs, clientInfo: { name: 'jarvis-local', version: '0.2.0' } }) : null;
  let saudeCache = { ate: 0, valor: null };
  let idRpc = 10;

  async function ferramentasAoVivo() {
    const r = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
    const tools = r.json?.result?.tools || [];
    return tools.filter(t => deveEncaminhar(t.name, t)).map(t => ({
      name: t.name, description: t.description, classe: 'LEITURA', inputSchema: t.inputSchema,
    }));
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado' };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    let valor = { ok: false, motivo: 'indisponivel' };
    try {
      const ferramentas = await ferramentasAoVivo();
      valor = { ok: true, motivo: 'ok', ferramentas: ferramentas.map(f => f.name) };
    } catch { valor = { ok: false, motivo: 'indisponivel' }; }
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  async function listar() {
    if (!ativa) throw new Error('nvidia-app: desligado');
    return ferramentasAoVivo();
  }

  async function chamar(nome, argumentos = {}) {
    if (!ativa) throw new Error('nvidia-app: desligado');
    if (!LEITURA.has(nome)) throw new Error(`nvidia-app: '${nome}' não é LEITURA e o cliente recusou`);
    const lista = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
    const meta = (lista.json?.result?.tools || []).find(t => t.name === nome);
    if (!deveEncaminhar(nome, meta)) throw new Error(`nvidia-app: '${nome}' recusada pela allowlist`);
    const r = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/call', params: { name: nome, arguments: argumentos || {} } });
    if (r.json?.error) throw new Error(`nvidia-app: ${r.json.error.message || r.json.error}`);
    return { name: nome, result: r.json?.result ?? null };
  }

  return { ativa, saudavel, listar, chamar, leitura: FERRAMENTAS_LEITURA, fechar: () => sessao?.fechar() };
}
