// Cliente único de chat Ollama (local ou Cloud), com streaming NDJSON. Sem dependências.
import { fetchUrl } from './http-unix.mjs';
// Nunca loga a chave. Devolve também os contadores de tokens para o registro de uso.
export async function chatOllama({ url, apiKey = '', model, messages, signal, timeoutMs = 180000, onDelta = () => {}, onPensando = () => {}, options, keepAlive, format, think, stream = true, nome = 'Ollama' }) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const abortar = () => ctrl.abort();
  signal?.addEventListener('abort', abortar);
  let resposta = '', pensou = false, tokensIn = null, tokensOut = null;
  try {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const corpo = { model, messages, stream };
    if (options) corpo.options = options;
    if (keepAlive) corpo.keep_alive = keepAlive;
    if (format) corpo.format = format;
    if (think !== undefined) corpo.think = think;
    const r = await fetchUrl(url, '/api/chat', { method: 'POST', signal: ctrl.signal, headers, body: JSON.stringify(corpo) });
    if (!r.ok) {
      let msg = await r.text().catch(() => '');
      try { msg = JSON.parse(msg).error || msg; } catch {}
      throw new Error(`${nome} respondeu HTTP ${r.status}: ${String(msg).slice(0, 300)}`);
    }
    if (!stream) {
      const j = await r.json();
      if (j.error) throw new Error(`${nome}: ${j.error}`);
      return { resposta: j.message?.content || '', tokensIn: j.prompt_eval_count ?? null, tokensOut: j.eval_count ?? null };
    }
    const dec = new TextDecoder(); let buf = '';
    const linhaJson = linha => {
      const j = JSON.parse(linha);
      if (j.error) throw new Error(`${nome}: ${j.error}`);
      if (j.message?.thinking && !pensou) { pensou = true; onPensando(); }
      if (j.message?.content) { resposta += j.message.content; onDelta(j.message.content); }
      if (j.done) { tokensIn = j.prompt_eval_count ?? tokensIn; tokensOut = j.eval_count ?? tokensOut; }
    };
    for await (const pedaco of r.body) {
      buf += dec.decode(pedaco, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (linha) linhaJson(linha);
      }
      clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), timeoutMs);
    }
    if (buf.trim()) linhaJson(buf.trim());
    return { resposta, tokensIn, tokensOut };
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error(`Tempo esgotado ou conexão interrompida com o ${nome}.`); err.parcial = resposta; err.timeout = true; throw err; }
    e.parcial = resposta; throw e;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abortar); }
}
