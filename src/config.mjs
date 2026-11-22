// Config do JARVIS — camadas: defaults do código → process.env → data/config.json (última ganha).
// Segredos nunca saem daqui com valor pleno: listar() devolve {configurado, sufixo, fonte}.
// Escrita sempre atômica (.tmp + rename). Rejeita corpo inválido em definir() sem gravar.
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const CACHE_RESOLVIDO_MS = 1000;
const CHAVES_PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
const COMANDOS = ['status', 'ajuda', 'custo', 'permissoes', 'hermes', 'nvidia', 'github'];

// Campos por api (validação) e quais são segredo.
const APIS = {
  ollamaCloud:    { campos: ['url', 'model', 'apiKey', 'timeoutMs'], segredo: ['apiKey'] },
  ollamaNativo:   { campos: ['url'], segredo: [] },
  ollamaDocker:   { campos: ['url'], segredo: [] },
  opencodeGo:     { campos: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'], segredo: ['apiKey'] },
  codex:          { campos: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'], segredo: ['apiKey'] },
  ninerouter:     { campos: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'], segredo: ['apiKey'] },
  hermes:         { campos: ['ligada', 'url', 'apiKey'], segredo: ['apiKey'] },
  nvidia:         { campos: ['ligada', 'url', 'token'], segredo: ['token'] },
  dockerMcp:      { campos: ['ligada', 'url', 'token'], segredo: ['token'] },
};
const SEGREDOS = Object.entries(APIS).flatMap(([id, a]) => a.segredo.map(c => `apis.${id}.${c}`));

const plano = o => Boolean(o) && typeof o === 'object' && !Array.isArray(o);
const temProp = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function mergeProfundo(base, extra) {
  for (const k of Object.keys(extra)) {
    if (plano(extra[k]) && plano(base[k])) mergeProfundo(base[k], extra[k]);
    else base[k] = extra[k];
  }
  return base;
}

function camadaDefault(env) {
  const ollamaUrl = String(env.OLLAMA_URL || 'https://ollama.com').replace(/\/$/, '');
  return {
    apis: {
      ollamaCloud: { url: ollamaUrl, apiKey: env.OLLAMA_API_KEY || '', model: env.JARVIS_MODEL || 'glm-5.3-flash', timeoutMs: Number(env.JARVIS_TIMEOUT_MS || 180000) },
      ollamaNativo: { url: 'http://host.docker.internal:11434' },
      ollamaDocker: { url: 'http://host.docker.internal:11435' },
      opencodeGo: { ligada: false, url: 'https://opencode.ai/inference/go/openai/v1', apiKey: '', model: 'kimi-k3', timeoutMs: 60000 },
      codex: { ligada: false, url: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-5.3-codex', timeoutMs: 60000 },
      ninerouter: { ligada: env.NINEROUTER_RESERVA === '1', url: env.NINEROUTER_URL || '', apiKey: env.NINEROUTER_API_KEY || '', model: env.NINEROUTER_MODEL || '', timeoutMs: Number(env.NINEROUTER_TIMEOUT_MS || 20000) },
      hermes: { ligada: Boolean(env.HERMES_URL), url: env.HERMES_URL || '', apiKey: env.HERMES_API_KEY || '' },
      nvidia: { ligada: env.NVIDIA_APP === '1', url: env.NVIDIA_MCP_URL || env.NVIDIA_PROXY_URL || '', token: env.NVIDIA_PROXY_TOKEN || '' },
      dockerMcp: { ligada: env.DOCKER_MCP === '1', url: env.DOCKER_MCP_URL || '', token: env.DOCKER_MCP_TOKEN || '' },
    },
    plugins: { telegram: Boolean(env.TELEGRAM_BOT_TOKEN), hermes: Boolean(env.HERMES_URL), nvidia: env.NVIDIA_APP === '1', github: env.DOCKER_MCP === '1' },
    skills: { desativadas: [] },
    links: [],
  };
}

function lerArquivoSeguro(arq, log) {
  try { const s = readFile(arq, 'utf8').then(t => JSON.parse(t)); return Promise.resolve(s).catch(() => null); } catch { return Promise.resolve(null); }
}

function emCaminho(obj, caminho) {
  let o = obj;
  for (const k of caminho.split('.')) {
    if (!plano(o) || !temProp(o, k)) return undefined;
    o = o[k];
  }
  return o;
}

function aplicarCaminho(obj, caminho, valor) {
  const ks = caminho.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (!plano(o[k])) o[k] = {};
    o = o[k];
  }
  o[ks.at(-1)] = valor;
}

function validar(parcial) {
  const falha = m => { const e = new Error(`config inválida: ${m}`); e.status = 400; throw e; };
  if (!plano(parcial)) falha('corpo precisa ser um objeto');
  for (const k of Object.keys(parcial)) if (CHAVES_PROIBIDAS.has(k)) falha('chave proibida');
  const ap = parcial.apis;
  if (ap !== undefined) {
    if (!plano(ap)) falha('apis precisa ser objeto');
    for (const id of Object.keys(ap)) {
      const spec = APIS[id];
      if (!spec) falha(`api desconhecida: ${id}`);
      if (!plano(ap[id])) falha(`apis.${id} precisa ser objeto`);
      for (const campo of Object.keys(ap[id])) {
        if (CHAVES_PROIBIDAS.has(campo)) falha('chave proibida');
        if (!spec.campos.includes(campo)) falha(`campo desconhecido em apis.${id}: ${campo}`);
        const v = ap[id][campo];
        if (campo === 'ligada' && typeof v !== 'boolean') falha(`apis.${id}.ligada precisa ser boolean`);
        if (campo === 'timeoutMs' && (!Number.isFinite(v) || v < 1000 || v > 600000)) falha(`apis.${id}.timeoutMs precisa ser número entre 1000 e 600000`);
        if ((campo === 'url' || campo === 'model' || campo === 'apiKey' || campo === 'token') && typeof v !== 'string') falha(`apis.${id}.${campo} precisa ser string`);
        if (campo === 'url' && v && !/^https?:\/\//.test(v)) falha(`apis.${id}.url precisa começar com http(s)://`);
      }
    }
  }
  const pl = parcial.plugins;
  if (pl !== undefined) {
    if (!plano(pl)) falha('plugins precisa ser objeto');
    for (const k of Object.keys(pl)) {
      if (!['telegram', 'hermes', 'nvidia', 'github'].includes(k)) falha(`plugin desconhecido: ${k}`);
      if (typeof pl[k] !== 'boolean') falha(`plugins.${k} precisa ser boolean`);
    }
  }
  const sk = parcial.skills;
  if (sk !== undefined) {
    if (!plano(sk) || !Array.isArray(sk.desativadas) || sk.desativadas.some(n => typeof n !== 'string')) falha('skills.desativadas precisa ser lista de strings');
  }
  if (parcial.links !== undefined) {
    const lks = parcial.links;
    if (!Array.isArray(lks) || lks.some(l => !plano(l) || typeof l.nome !== 'string' || typeof l.url !== 'string' || (l.nota !== undefined && typeof l.nota !== 'string'))) falha('links precisa ser lista de {nome, url, nota?}');
    for (const l of lks) if (l.url && !/^https?:\/\//.test(l.url)) falha('links[].url precisa começar com http(s)://');
  }
  return parcial;
}

export function criarConfig({ dataDir, env = process.env, agora = () => Date.now(), fetchFn = fetch, probes = {}, log = () => {} } = {}) {
  const arq = path.join(dataDir, 'config.json');
  let arquivo = { lido: 0, valor: null };      // camada do arquivo (pode ser null: inexistente ou corrompido)
  let resolvidoCache = { ate: 0, valor: null };

  async function camadaArquivo() {
    const t = agora();
    if (t - arquivo.lido < CACHE_RESOLVIDO_MS) return arquivo.valor;
    let v = null;
    try {
      const txt = await readFile(arq, 'utf8');
      const j = JSON.parse(txt);
      if (plano(j)) v = j; else log('config.json não é objeto — ignorado (cai para env)');
    } catch {
      if (v === null) { try { await readFile(arq, 'utf8'); } catch { /* não existe: normal no primeiro boot */ } }
      if (arquivo.valor === undefined) v = null;
    }
    arquivo = { lido: t, valor: v };
    return v;
  }

  async function invalidar() { arquivo = { lido: 0, valor: arquivo.valor !== undefined ? arquivo.valor : null }; resolvidoCache = { ate: 0, valor: null }; }

  async function resolucao() {
    const t = agora();
    if (t < resolvidoCache.ate && resolvidoCache.valor) return resolvidoCache.valor;
    const def = camadaDefault(env);
    const arq = await camadaArquivo();
    const valor = arq ? mergeProfundo(def, structuredClone(arq)) : def;
    resolvidoCache = { ate: t + CACHE_RESOLVIDO_MS, valor };
    return valor;
  }

  function fonteDeSegredo(caminho, res, camadaArq) {
    const noArquivo = camadaArq && emCaminho(camadaArq, caminho);
    if (typeof noArquivo === 'string' && noArquivo) return 'config';
    const noDefault = emCaminho(camadaDefault(env), caminho);
    if (typeof noDefault === 'string' && noDefault) return 'env';
    return 'default';
  }

  function mascarar(valor, fonte) {
    if (typeof valor === 'string' && valor) return { configurado: true, sufixo: '…' + valor.slice(-4), fonte };
    return { configurado: false, sufixo: null, fonte };
  }

  function clonarMascarado(res, camadaArq) {
    const out = structuredClone(res);
    for (const caminho of SEGREDOS) {
      const valor = emCaminho(out, caminho);
      aplicarCaminho(out, caminho, mascarar(valor, fonteDeSegredo(caminho, res, camadaArq)));
    }
    return out;
  }

  async function listar() {
    const [res, camadaArq] = await Promise.all([resolucao(), camadaArquivo()]);
    return { ...clonarMascarado(res, camadaArq), comandos: COMANDOS };
  }

  async function resolvido() {
    const r = await resolucao();
    // Achatado por seção para o server: apis no topo + skillsDesativadas direto (ver spec/plano).
    return { ...structuredClone(r.apis), plugins: r.plugins, skillsDesativadas: r.skills.desativadas, links: r.links };
  }

  async function definir(parcial) {
    validar(parcial);
    const resAntigo = await resolucao();
    const camadaArq = await camadaArquivo();
    const novo = camadaArq ? mergeProfundo(structuredClone(camadaArq), structuredClone(parcial)) : structuredClone(parcial);
    // Segredo vazio/ausente no parcial, quando a api foi tocada, PROMOVE o valor atual para o arquivo.
    for (const caminho of SEGREDOS) {
      const mencionado = emCaminho(parcial, caminho) !== undefined || emCaminho({ apis: parcial.apis || {} }, caminho) !== undefined;
      const secoesTocadas = Object.keys(parcial.apis || {});
      const idApi = caminho.split('.')[1];
      const campo = caminho.split('.')[2];
      const valorNovo = emCaminho(novo, caminho);
      const tocouApi = secoesTocadas.includes(idApi);
      if (tocouApi && (!temProp((novo.apis || {})[idApi] || {}, campo) || valorNovo === '')) {
        const atual = emCaminho(resAntigo, caminho);
        if (typeof atual === 'string' && atual) aplicarCaminho(novo, caminho, atual);
      }
    }
    // links/skills/desativadas: merge direto (por seção, não profundo em listas)
    for (const secao of ['skills', 'links', 'plugins']) {
      if (parcial[secao] !== undefined) novo[secao] = structuredClone(parcial[secao]);
    }
    const tmp = arq + '.' + Date.now() + '.tmp';
    await writeFile(tmp, JSON.stringify(novo, null, 2));
    await rename(tmp, arq);
    await invalidar();
    arquivo = { lido: 0, valor: novo };   // invalida cache para reler já com o novo conteúdo
    return listar();
  }

  // Probe só de leitura com timeout curto e sanitização de segredos na mensagem de erro.
  async function probeHttp(url, chave = '') {
    const headers = chave ? { authorization: `Bearer ${chave}` } : {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetchFn(url, { method: 'GET', signal: ctrl.signal, headers });
      if (!r.ok) {
        let msg = '';
        try { const txt = await r.text(); try { const j = JSON.parse(txt); msg = typeof j.error === 'string' ? j.error : (j.error?.message || txt); } catch { msg = txt; } } catch {}
        msg = String(msg).slice(0, 120);
        if (r.status === 401) return { ok: false, detalhe: 'chave recusada (401)' };
        return { ok: false, detalhe: `HTTP ${r.status}: ${msg || 'sem corpo'}` };
      }
      return { ok: true, corpo: await r.json().catch(() => ({})) };
    } finally { clearTimeout(timer); }
  }

  async function testar(id) {
    const t0 = agora();
    const res = await resolucao();
    const segredos = ['ollamaCloud', 'opencodeGo', 'codex', 'ninerouter', 'hermes'].map(a => res.apis[a].apiKey).concat([res.apis.nvidia.token, res.apis.dockerMcp.token]).filter(v => typeof v === 'string' && v);
    const sanitizar = s => { let out = String(s); for (const v of segredos) out = out.split(v).join('[chave]'); return out.slice(0, 120); };
    let out;
    if (id === 'nvidia' || id === 'github') {
      const p = probes[id];
      if (!p) throw new Error(`id desconhecido: ${id}`);
      try { const r = await p(); out = { ok: Boolean(r?.ok), detalhe: sanitizar(r?.detalhe || 'ok') }; } catch (e) { out = { ok: false, detalhe: sanitizar(e.message) }; }
    } else if (APIS[id] && id.startsWith('ollama')) {
      const base = String(res.apis[id].url).replace(/\/$/, '');
      const r = await probeHttp(`${base}/api/tags`, res.apis[id].apiKey || '').catch(e => ({ ok: false, detalhe: sanitizar(e.message) }));
      out = r.ok ? { ok: true, detalhe: `${(r.corpo.models || []).length} modelos` } : r;
    } else if (id === 'opencodeGo' || id === 'codex') {
      const api = res.apis[id];
      if (!api.url || !api.apiKey) out = { ok: false, detalhe: 'url/chave não configuradas' };
      else {
        const base = String(api.url).replace(/\/$/, '');
        const r = await probeHttp(`${base}/models`, api.apiKey).catch(e => ({ ok: false, detalhe: sanitizar(e.message) }));
        const nomes = r.ok ? (r.corpo.data || []).map(m => m.id || m.name).filter(Boolean).slice(0, 3).join(', ') : '';
        out = r.ok ? { ok: true, detalhe: `${(r.corpo.data || []).length} modelos${nomes ? `: ${nomes}` : ''}` } : r;
      }
    } else if (id === 'ninerouter') {
      const api = res.apis[id];
      if (!api.url) out = { ok: false, detalhe: 'url não configurada' };
      else {
        const raiz = String(api.url).replace(/\/+$/, '').replace(/\/v1$/, '');
        const r = await probeHttp(`${raiz}/api/health`).catch(e => ({ ok: false, detalhe: sanitizar(e.message) }));
        out = r.ok ? { ok: true, detalhe: r.corpo.ok === true ? 'ok' : 'respondeu sem ok:true' } : r;
      }
    } else if (id === 'hermes') {
      const api = res.apis[id];
      if (!api.url) out = { ok: false, detalhe: 'url não configurada (HERMES_URL)' };
      else {
        const base = String(api.url).replace(/\/$/, '');
        const r = await probeHttp(`${base}/health`).catch(e => ({ ok: false, detalhe: sanitizar(e.message) }));
        out = r.ok ? { ok: true, detalhe: 'ok' } : r;
      }
    } else throw new Error(`id desconhecido: ${String(id)}`);
    if (out) out = { ...out, detalhe: sanitizar(out.detalhe ?? '') };
    return { ...(out || { ok: false, detalhe: 'sem probe' }), ms: Math.round(agora() - t0) };
  }

  return { listar, definir, resolvido, testar };
}
