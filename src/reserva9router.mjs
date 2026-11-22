// Reserva 9Router (PC do Jean, OpenAI-compatível). DESLIGADA por padrão (NINEROUTER_RESERVA=1 liga).
// Só é usada quando o caminho principal (nuvem Ollama da assinatura) falhou. Cai quando o PC desliga.
// Antes de tentar: GET <base>/api/health (sem custo), com cache curto. Nunca loga a chave.
export function criarReserva({ ligada, url, model, apiKey, timeoutMs = 20000, cacheMs = 60000, agora = () => Date.now(), fetchFn = fetch }) {
  const base = String(url || '').replace(/\/+$/, '');              // ex.: https://x.abc-tunnel.us/v1
  const raiz = base.replace(/\/v1$/, '');                         // health fica sem /v1
  const ativa = Boolean(ligada && base && model && apiKey);
  let saudeCache = { ate: 0, ok: false }, bloqueadoAte = 0;

  async function saudavel() {
    const t = agora();
    if (t < bloqueadoAte) return false;
    if (t < saudeCache.ate) return saudeCache.ok;
    let ok = false;
    try {
      const c = new AbortController(); const tm = setTimeout(() => c.abort(), 5000);
      const r = await fetchFn(`${raiz}/api/health`, { signal: c.signal }).finally(() => clearTimeout(tm));
      ok = r.ok && (await r.json().catch(() => ({}))).ok === true;
    } catch { ok = false; }
    saudeCache = { ate: t + cacheMs, ok };
    return ok;
  }

  async function erroHttp(r) {
    let msg = await r.text().catch(() => '');
    try { const j = JSON.parse(msg); msg = j.error?.message || j.error || msg; } catch {}
    msg = String(msg).slice(0, 200);
    if (r.status === 401) return new Error('9Router: chave recusada (401)');
    if (r.status === 400) return new Error(`9Router: pedido/modelo inválido (400) ${msg}`);
    if (r.status === 503) {
      const ra = Number(r.headers.get('retry-after')) || 60;
      bloqueadoAte = agora() + ra * 1000;
      return new Error(`9Router: contas indisponíveis (503), nova tentativa só em ${ra}s`);
    }
    return new Error(`9Router respondeu HTTP ${r.status}: ${msg}`);
  }

  async function chat({ messages, signal, onDelta = () => {} }) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const abortar = () => ctrl.abort(); signal?.addEventListener('abort', abortar);
    let resposta = '', tokensIn = null, tokensOut = null;
    try {
      const r = await fetchFn(`${base}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
      });
      if (!r.ok) throw await erroHttp(r);
      const dec = new TextDecoder(); let buf = '';
      for await (const pedaco of r.body) {
        buf += dec.decode(pedaco, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!linha.startsWith('data:')) continue;
          const dado = linha.slice(5).trim();
          if (dado === '[DONE]') continue;
          const j = JSON.parse(dado);
          if (j.error) throw new Error(`9Router: ${j.error.message || j.error}`);
          const d = j.choices?.[0]?.delta?.content;
          if (d) { resposta += d; onDelta(d); }
          if (j.usage) { tokensIn = j.usage.prompt_tokens ?? tokensIn; tokensOut = j.usage.completion_tokens ?? tokensOut; }
        }
        clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), timeoutMs);
      }
      if (!resposta) throw new Error('9Router terminou sem resposta');
      return { resposta, tokensIn, tokensOut };
    } catch (e) {
      const err = e.name === 'AbortError' ? new Error('9Router: tempo esgotado') : e;
      err.parcial = resposta; throw err;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abortar); }
  }

  return { ativa, model, saudavel, chat };
}
