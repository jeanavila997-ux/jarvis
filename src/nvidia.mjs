// Cliente do proxy allowlist do nvidia-app (PC do Jean). DESLIGADO por padrão (NVIDIA_APP=1 liga).
// Fala só com o proxy (URL + token), nunca direto com o MCP. Só ferramentas de LEITURA.
// Cai quando o PC desliga ou o túnel não está no ar. Nunca loga o token.
export const FERRAMENTAS_LEITURA = Object.freeze([
  'nvapp_overlay_get_status',
  'nvapp_overlay_get_current_game_info',
  'nvapp_client_get_applications',
  'nvapp_client_get_driver_status',
  'nvapp_client_get_driver_release_notes',
  'nvapp_client_get_laptop_features',
]);

const LEITURA = new Set(FERRAMENTAS_LEITURA);

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
