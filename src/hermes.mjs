// Cliente da API do Hermes (gateway 0.23.x em 127.0.0.1:8642 no host).
// Status em /health não exige chave. Listar/alterar tarefas exige Bearer (HERMES_API_KEY).
// Ações que mudam estado (criar/pausar/retomar/rodar/atualizar/apagar) são nível 2:
// o módulo só executa quando o chamador já passou pela confirmação do Telegram.
// Nunca loga a chave. Não expõe /api/env, credenciais ou revelação de segredos.
import { fetchUrl } from './http-unix.mjs';
import { normalizar } from './retrieval.mjs';

export const ACOES_LEITURA = Object.freeze(['status', 'tarefas', 'tarefa']);
export const ACOES_NIVEL2 = Object.freeze(['pausar', 'retomar', 'rodar', 'criar', 'atualizar', 'apagar']);

export function criarClienteHermes({
  ligada = false,
  url = '',
  apiKey = '',
  timeoutMs = 8000,
  cacheMs = 15000,
  agora = () => Date.now(),
  fetchFn = null,
} = {}) {
  const base = String(url || '').trim().replace(/\/$/, '');
  const ativa = Boolean(ligada && base);
  const chave = String(apiKey || '');
  let saudeCache = { ate: 0, valor: null };

  function cabecalhos(comChave) {
    const h = { accept: 'application/json' };
    if (comChave && chave) h.authorization = `Bearer ${chave}`;
    return h;
  }

  async function pedido(path, { method = 'GET', body, comChave = true, timeout = timeoutMs } = {}) {
    if (!ativa) throw new Error('hermes: desligado');
    const c = new AbortController();
    const tm = setTimeout(() => c.abort(), timeout);
    try {
      const headers = cabecalhos(comChave);
      const opts = { method, headers, signal: c.signal };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = fetchFn
        ? await fetchFn(path, opts)
        : await fetchUrl(base, path, opts);
      const text = await r.text();
      let json = null;
      if (text) { try { json = JSON.parse(text); } catch { json = { texto: text.slice(0, 300) }; } }
      if (r.status === 401) throw new Error('hermes: chave recusada (401). Peça a HERMES_API_KEY ao Grok Bot.');
      if (!r.ok) {
        const msg = json?.error?.message || json?.error || json?.texto || text;
        throw new Error(`hermes respondeu HTTP ${r.status}: ${String(msg).slice(0, 200)}`);
      }
      return json;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('hermes: tempo esgotado');
      throw e;
    } finally { clearTimeout(tm); }
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado' };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    let valor = { ok: false, motivo: 'indisponivel' };
    try {
      const j = await pedido('/health', { comChave: false, timeout: 4000 });
      valor = { ok: j?.status === 'ok', motivo: j?.status === 'ok' ? 'ok' : 'http', versao: j?.version, plataforma: j?.platform };
    } catch { valor = { ok: false, motivo: 'indisponivel' }; }
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  async function detalhado() {
    if (!chave) throw new Error('hermes: HERMES_API_KEY ausente (status detalhado exige chave)');
    return pedido('/health/detailed');
  }

  function normalizarTarefas(json) {
    const lista = Array.isArray(json) ? json
      : Array.isArray(json?.jobs) ? json.jobs
      : Array.isArray(json?.items) ? json.items
      : [];
    return lista.map(j => ({
      id: String(j.id || j.job_id || j.jobId || ''),
      nome: j.name || j.title || j.prompt || j.id || '',
      estado: j.state || j.status || (j.paused ? 'paused' : 'unknown'),
      agendamento: j.schedule || j.cron || j.expression || '',
    }));
  }

  async function listarTarefas() {
    if (!chave) throw new Error('hermes: HERMES_API_KEY ausente (listar tarefas exige chave)');
    return normalizarTarefas(await pedido('/api/jobs'));
  }

  async function obterTarefa(id) {
    if (!chave) throw new Error('hermes: HERMES_API_KEY ausente');
    const j = await pedido(`/api/jobs/${encodeURIComponent(id)}`);
    const [n] = normalizarTarefas(Array.isArray(j) ? j : [j]);
    return n || j;
  }

  // Mutações: o chamador DEVE ter obtido confirmação nível 2 antes.
  async function pausar(id) { return pedido(`/api/jobs/${encodeURIComponent(id)}/pause`, { method: 'POST', body: {} }); }
  async function retomar(id) { return pedido(`/api/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST', body: {} }); }
  async function rodar(id) { return pedido(`/api/jobs/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} }); }
  async function apagar(id) { return pedido(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async function criar(corpo) { return pedido('/api/jobs', { method: 'POST', body: corpo || {} }); }
  async function atualizar(id, corpo) { return pedido(`/api/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo || {} }); }

  async function executar(pedidoAcao) {
    const a = pedidoAcao?.acao;
    const id = pedidoAcao?.id;
    if (ACOES_LEITURA.includes(a)) {
      if (a === 'status') return saudavel();
      if (a === 'tarefas') return listarTarefas();
      if (a === 'tarefa') return obterTarefa(id);
    }
    if (!ACOES_NIVEL2.includes(a)) throw new Error(`hermes: ação desconhecida (${a})`);
    if (a === 'pausar') return pausar(id);
    if (a === 'retomar') return retomar(id);
    if (a === 'rodar') return rodar(id);
    if (a === 'apagar') return apagar(id);
    if (a === 'criar') return criar(pedidoAcao.corpo);
    if (a === 'atualizar') return atualizar(id, pedidoAcao.corpo);
  }

  return {
    ativa, temChave: Boolean(chave),
    saudavel, detalhado, listarTarefas, obterTarefa,
    pausar, retomar, rodar, apagar, criar, atualizar, executar,
  };
}

// Interpreta pedidos curtos em pt-BR. Não executa nada.
export function interpretarPedidoHermes(texto) {
  const t = normalizar(String(texto || '').trim()).replace(/@\w+/, '');
  if (!t) return null;
  const falaDeHermes = /\bhermes\b/.test(t) || /^\/hermes\b/.test(t);
  if (!falaDeHermes) return null;

  const idM = t.match(/\b(id|tarefa|job)\s*[:#]?\s*([a-z0-9_-]{2,80})\b/) || t.match(/\b([0-9a-f]{8,})\b/);
  const id = idM ? (idM[2] || idM[1]) : '';

  if (/\b(apag\w*|delet\w*|exclu\w*|remov\w*)\b/.test(t) && /\b(tarefa|job|cron)\b/.test(t)) {
    return id ? { acao: 'apagar', id, nivel: 2, rotulo: `apagar tarefa ${id} do Hermes` }
              : { acao: 'apagar', id: '', nivel: 2, rotulo: 'apagar tarefa do Hermes', erro: 'informe o id da tarefa' };
  }
  if (/\b(paus\w*)\b/.test(t)) {
    return id ? { acao: 'pausar', id, nivel: 2, rotulo: `pausar tarefa ${id} do Hermes` }
              : { acao: 'pausar', id: '', nivel: 2, rotulo: 'pausar tarefa do Hermes', erro: 'informe o id da tarefa' };
  }
  if (/\b(retom\w*|resum\w*|despaus\w*)\b/.test(t)) {
    return id ? { acao: 'retomar', id, nivel: 2, rotulo: `retomar tarefa ${id} do Hermes` }
              : { acao: 'retomar', id: '', nivel: 2, rotulo: 'retomar tarefa do Hermes', erro: 'informe o id da tarefa' };
  }
  if (/\b(rod\w*|execut\w*|dispar\w*|trigger|agora)\b/.test(t) && /\b(tarefa|job|cron)\b/.test(t)) {
    return id ? { acao: 'rodar', id, nivel: 2, rotulo: `rodar agora a tarefa ${id} do Hermes` }
              : { acao: 'rodar', id: '', nivel: 2, rotulo: 'rodar tarefa do Hermes', erro: 'informe o id da tarefa' };
  }
  if (/\b(cri\w*|nova)\b/.test(t) && /\b(tarefa|job|cron)\b/.test(t)) {
    return { acao: 'criar', nivel: 2, rotulo: 'criar tarefa no Hermes', erro: 'criação ainda precisa dos campos (nome, cron) no /hermes; não executo pelo chat livre' };
  }
  if (/\b(tarefa|tarefas|jobs?|cron)\b/.test(t) && /\b(lista|listar|quais|mostra|ver)\b/.test(t) || /^\/hermes\s+(tarefas|jobs)$/.test(t) || /^(tarefas|jobs)\s+(do\s+)?hermes$/.test(t)) {
    return { acao: 'tarefas', nivel: 0, rotulo: 'listar tarefas do Hermes' };
  }
  if (/\b(status|saude|como\s+esta|no\s+ar|online|versao)\b/.test(t) || /^\/hermes$/.test(t) || /^hermes$/.test(t)) {
    return { acao: 'status', nivel: 0, rotulo: 'status do Hermes' };
  }
  // Pedido genérico mencionando Hermes: trata como status (leitura).
  if (/^\/hermes\b/.test(t) || t === 'hermes') return { acao: 'status', nivel: 0, rotulo: 'status do Hermes' };
  return { acao: 'status', nivel: 0, rotulo: 'status do Hermes' };
}

export function textoHermesStatus(s, tarefas = null) {
  if (!s) return 'Hermes: sem dados.';
  if (!s.ok) return `Hermes: indisponível (${s.motivo || 'sem detalhe'}).`;
  let out = `Hermes no ar (versão ${s.versao || '?'}, plataforma ${s.plataforma || 'hermes-agent'}).`;
  if (Array.isArray(tarefas)) {
    if (!tarefas.length) out += '\nNenhuma tarefa cron listada.';
    else out += '\nTarefas:\n' + tarefas.slice(0, 20).map(j => `• ${j.id || '—'} — ${j.nome || 'sem nome'} (${j.estado}${j.agendamento ? ', ' + j.agendamento : ''})`).join('\n');
    if (tarefas.length > 20) out += `\n… e mais ${tarefas.length - 20}.`;
  }
  return out;
}
