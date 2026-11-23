// Aba Config (Etapa 2): APIs (cards + Testar agora) · Senhas · Skills · Comandos · MCP · Plugins · Links.
// Sem framework; segredos nunca voltam do servidor (só sufixo) e erros nunca ecoam a chave.
'use strict';
const jc = s => document.querySelector(s);
let cfgAtual = null;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOMES_APIS = {
  ollamaCloud: 'Ollama da assinatura (principal)',
  ollamaNativo: 'Ollama nativo do PC :11434',
  ollamaDocker: 'Ollama Docker :11435',
  opencodeGo: 'OpenCode Go (Console)',
  codex: 'OpenAI Codex',
  ninerouter: 'Reserva 9Router',
  hermes: 'Hermes',
  nvidia: 'NVIDIA (nvidia-app)',
  dockerMcp: 'GitHub (Docker MCP Gateway)',
};
const CAMPOS = {
  ollamaCloud: ['url', 'model', 'apiKey', 'timeoutMs'],
  ollamaNativo: ['url'], ollamaDocker: ['url'],
  opencodeGo: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'],
  codex: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'],
  ninerouter: ['ligada', 'url', 'apiKey', 'model', 'timeoutMs'],
  hermes: ['ligada', 'url', 'apiKey'],
  nvidia: ['ligada', 'url', 'token'],
  dockerMcp: ['ligada', 'url', 'token'],
};
const ROTULOS_CAMPO = { url: 'URL base', model: 'Modelo', apiKey: 'Chave de API', timeoutMs: 'Timeout (ms)', ligada: 'Ligada', token: 'Token' };
const SEGREDOS = [
  ['apis.ollamaCloud.apiKey', 'Ollama Cloud', 'apis', 'ollamaCloud', 'apiKey'],
  ['apis.opencodeGo.apiKey', 'OpenCode Go (oc_sk…)', 'apis', 'opencodeGo', 'apiKey'],
  ['apis.codex.apiKey', 'OpenAI Codex', 'apis', 'codex', 'apiKey'],
  ['apis.ninerouter.apiKey', 'Reserva 9Router', 'apis', 'ninerouter', 'apiKey'],
  ['apis.hermes.apiKey', 'Hermes', 'apis', 'hermes', 'apiKey'],
  ['apis.nvidia.token', 'NVIDIA (proxy)', 'apis', 'nvidia', 'token'],
  ['apis.dockerMcp.token', 'Docker MCP Gateway', 'apis', 'dockerMcp', 'token'],
];

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`); return r.json(); }
async function postar(url, obj) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(obj) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

let abaAtiva = 'apis';
async function recarregar() { cfgAtual = await getJson('/api/config'); }
function marcarTeste(id, r) {
  const chip = jc(`#chip-${id}`);
  if (!chip) return;
  chip.className = 'chip ' + (r?.ok ? 'ok' : 'falha');
  chip.textContent = r ? `${r.ok ? '✓' : '✗'} ${r.ms ?? '?'} ms · ${r.detalhe ?? ''}` : '—';
}

function cardApi(id, api, segredos) {
  const campos = CAMPOS[id];
  const linhas = campos.map(c => {
    const v = api[c];
    if (c === 'ligada') return `<label class="linhacampo"><span>${ROTULOS_CAMPO[c]}</span><input type="checkbox" class="inpcfg" data-campo="${c}" ${v ? 'checked' : ''}></label>`;
    if (typeof v === 'number') return `<label class="linhacampo"><span>${ROTULOS_CAMPO[c]}</span><input class="inpcfg" data-campo="${c}" type="number" value="${v}"></label>`;
    if (segredos.includes(c)) return `<label class="linhacampo"><span>${ROTULOS_CAMPO[c]}</span><input class="inpcfg" data-campo="${c}" type="password" placeholder="${v?.configurado ? `${v.sufixo} (vazio mantém)` : 'não configurada'}"></label>`;
    return `<label class="linhacampo"><span>${ROTULOS_CAMPO[c]}</span><input class="inpcfg" data-campo="${c}" type="text" value="${esc(v)}"></label>`;
  }).join('');
  return `<div class="cardapi" id="card-${id}">
    <div class="cardtit"><strong>${esc(NOMES_APIS[id] || id)}</strong><span class="chip" id="chip-${id}">—</span></div>
    ${linhas}
    <div class="acoes"><button class="btncfg testar" data-id="${id}">Testar agora</button><button class="btncfg salvar" data-id="${id}">Salvar</button></div>
  </div>`;
}

function abaApis() {
  const cards = Object.keys(NOMES_APIS).map(id => cardApi(id, cfgAtual.apis[id], CAMPOS[id].filter(c => ['apiKey', 'token'].includes(c)))).join('');
  return `<p class="notacfg">Editar salva em <code>data/config.json</code> e vale em runtime (sem restart). “Testar agora” é sempre leitura.</p><div class="cards">${cards}</div>`;
}

async function salvarCard(id) {
  const card = jc(`#card-${id}`);
  const parcial = {};
  for (const inp of card.querySelectorAll('.inpcfg')) {
    const c = inp.dataset.campo;
    if (inp.type === 'checkbox') parcial[c] = inp.checked;
    else if (inp.type === 'password') { if (inp.value.trim()) parcial[c] = inp.value.trim(); }
    else if (inp.type === 'number') parcial[c] = Number(inp.value);
    else if (inp.value.trim()) parcial[c] = inp.value.trim();
  }
  try {
    await postar('/api/config', { apis: { [id]: parcial } });
    await recarregar();
    abrirAba('apis');
    marcarSistema('Salvo.');
  } catch (e) { marcarSistema('Erro: ' + e.message); }
}

async function testarCard(id) { marcarTeste(id, null); try { marcarTeste(id, await postar('/api/config/testar', { id })); } catch (e) { const chip = jc(`#chip-${id}`); if (chip) { chip.className = 'chip falha'; chip.textContent = '✗ ' + e.message; } } }

function abaSenhas() {
  const linhas = SEGREDOS.map(([caminho, nome, sec, id, campo]) => {
    const m = cfgAtual.apis?.[id]?.[campo] || { configurado: false, sufixo: null };
    return `<div class="cardapi senha" id="senha-${id}-${campo}">
      <div class="cardtit"><strong>${esc(nome)}</strong><span class="chip ${m.configurado ? 'ok' : ''}">${m.configurado ? `✓ configurada ${m.sufixo}` : 'não configurada'}</span></div>
      <label class="linhacampo"><span>Nova chave</span><input class="inpcfg" type="password" placeholder="deixe vazio para manter"></label>
      <div class="acoes"><button class="btncfg salvar" data-id="${id}" data-campo="${campo}" data-secao="${sec}">Trocar</button></div>
    </div>`;
  }).join('');
  return `<p class="notacfg">A chave nunca volta com o valor — só “configurada” e o fim dela. Deixe vazio para manter a atual.</p><div class="cards">${linhas}</div>`;
}

async function trocarSenha(botao) {
  const card = botao.closest('.cardapi');
  const inp = card.querySelector('input[type="password"]');
  if (!inp.value.trim()) { marcarSistema('Informe a nova chave (vazio mantém).'); return; }
  const corpo = JSON.parse(`{"${botao.dataset.secao}":{"${botao.dataset.id}":{"${botao.dataset.campo}":${JSON.stringify(inp.value.trim())}}}}`);
  try { await postar('/api/config', corpo); inp.value = ''; await recarregar(); abrirAba(abaAtiva); marcarSistema('Chave atualizada.'); }
  catch (e) { marcarSistema('Erro: ' + e.message); }
}

function abaSkills(instaladas = []) {
  const lista = instaladas.map(s => {
    const off = (cfgAtual.skills.desativadas || []).includes(s.nome);
    return `<div class="cardapi"><div class="cardtit"><strong>${esc(s.nome)}</strong><span class="chip ${off ? '' : 'ok'}">${off ? 'desativada' : 'ativa'}</span></div>
      <p class="desc">${esc(s.descricao)} <em>(${s.chars} caracteres)</em></p>
      <div class="acoes"><button class="btncfg toggle" data-nome="${esc(s.nome)}" data-off="${off}">${off ? 'Ativar' : 'Desativar'}</button><button class="btncfg vercorpo" data-nome="${esc(s.nome)}">Ver corpo</button></div>
      <pre class="corposkill hidden"></pre></div>`;
  }).join('');
  return `<p class="notacfg">Skills entram no prompt da rota nuvem quando ativadas. Elas não executam comandos.</p><div class="cards">${lista || '<p class="notacfg">Nenhuma skill instalada (data/skills/).</p>'}</div>`;
}

function abaComandos() {
  const chips = (cfgAtual.comandos || []).map(c => `<span class="chip ok">${esc(c)}</span>`).join(' ');
  return `<p class="notacfg">Comandos fixos respondidos por regra, sem IA e sem custo. Edição de textos fica para outra etapa.</p><div class="cards">${chips}</div>`;
}

function abaMcp() {
  const mcp = cfgAtual.mcp || {};
  const linha = (nome, m) => `<div class="cardapi"><div class="cardtit"><strong>${esc(nome)}</strong><span class="chip ${m?.ok ? 'ok' : 'falha'}">${m ? (m.ok ? `✓ ${(m.ferramentas || []).length} ferramentas` : `✗ ${esc(m.motivo || 'indisponível')}`) : 'desligado'}</span></div>
    ${(m?.ferramentas || []).map(f => `<span class="chip">${esc(f)}</span>`).join(' ')}</div>`;
  return `<div class="cards">${linha('NVIDIA (nvidia-app)', mcp.nvidia)}${linha('GitHub (Docker MCP)', mcp.github)}</div><p class="notacfg">Status medido na última verificação de saúde. Só ferramentas de LEITURA são tentadas.</p>`;
}

function abaPlugins() {
  const p = cfgAtual.plugins || {};
  const switchs = Object.keys(p).map(k => `<div class="cardapi"><div class="cardtit"><strong>${esc(k)}</strong><label class="linhacampo"><input type="checkbox" class="inpcfg" data-campo="${k}" ${p[k] ? 'checked' : ''}></label></div></div>`).join('');
  return `<p class="notacfg">O estado é salvo na config; os clientes de integração hoje aplicam no restart do container. Telegram segue o token do .env.</p><div class="cards">${switchs}<div class="acoes"><button class="btncfg salvarplugins">Salvar plugins</button></div></div>`;
}

function abaLinks() {
  const lks = cfgAtual.links || [];
  const linhas = lks.map((l, i) => `<div class="cardapi"><input class="inpcfg lknome" data-i="${i}" type="text" value="${esc(l.nome)}"><input class="inpcfg lkurl" data-i="${i}" type="text" value="${esc(l.url)}"><input class="inpcfg lknota" data-i="${i}" type="text" value="${esc(l.nota)}" placeholder="nota (opcional)"><button class="btncfg rmlink" data-i="${i}">Remover</button></div>`).join('');
  return `<p class="notacfg">Links rápidos do Jean (nome, URL, nota).</p><div class="cards">${linhas}<button class="btncfg addlink">+ Adicionar link</button><button class="btncfg salvarlinks">Salvar links</button></div>`;
}

async function salvarLinks() {
  const lks = [...jc('#configConteudo').querySelectorAll('.cardapi')].map(card => {
    const card2 = card.querySelector('.lknome') ? card : null;
    if (!card2) return null;
    return { nome: card.querySelector('.lknome').value.trim(), url: card.querySelector('.lkurl').value.trim(), nota: card.querySelector('.lknota').value.trim() };
  }).filter(Boolean).filter(l => l.nome || l.url);
  try { await postar('/api/config', { links: lks }); await recarregar(); abrirAba('links'); marcarSistema('Links salvos.'); } catch (e) { marcarSistema('Erro: ' + e.message); }
}

async function abrirAba(aba) {
  abaAtiva = aba;
  const conteudo = jc('#configConteudo');
  const abas = [['apis', 'APIs'], ['senhas', 'Senhas'], ['skills', 'Skills'], ['comandos', 'Comandos'], ['mcp', 'MCP'], ['plugins', 'Plugins'], ['links', 'Links']];
  jc('#configAbas').innerHTML = abas.map(([k, n]) => `<button class="aba ${k === aba ? 'ativa' : ''}" data-aba="${k}">${n}</button>`).join('');
  if (aba === 'apis') conteudo.innerHTML = abaApis();
  else if (aba === 'senhas') conteudo.innerHTML = abaSenhas();
  else if (aba === 'skills') { const s = await getJson('/api/skills'); conteudo.innerHTML = abaSkills(s.instaladas || []); }
  else if (aba === 'comandos') conteudo.innerHTML = abaComandos();
  else if (aba === 'mcp') conteudo.innerHTML = abaMcp();
  else if (aba === 'plugins') conteudo.innerHTML = abaPlugins();
  else if (aba === 'links') conteudo.innerHTML = abaLinks();
  let sistema = jc('#statuscfg'); if (!sistema) { sistema = document.createElement('div'); sistema.id = 'statuscfg'; sistema.className = 'notacfg'; conteudo.prepend(sistema); } sistema.textContent = marcarSistema.msg || '';
}

function marcarSistema(msg) { marcarSistema.msg = msg; const s = jc('#statuscfg'); if (s) s.textContent = msg; }

// eventos (delegação no dialog)
jc('#janelaconfig').addEventListener('click', async e => {
  const alvo = e.target;
  if (alvo.classList.contains('aba')) return abrirAba(alvo.dataset.aba);
  if (alvo.classList.contains('testar')) return testarCard(alvo.dataset.id);
  if (alvo.classList.contains('salvar')) return salvarCard(alvo.dataset.id);
  if (alvo.classList.contains('salvarplugins')) {
    const plugins = {}; jc('#configConteudo').querySelectorAll('.inpcfg[data-campo]').forEach(i => plugins[i.dataset.campo] = i.checked);
    try { await postar('/api/config', { plugins }); await recarregar(); abrirAba('plugins'); marcarSistema('Plugins salvos.'); } catch (ex) { marcarSistema('Erro: ' + ex.message); }
    return;
  }
  if (alvo.classList.contains('toggle')) {
    const nome = alvo.dataset.nome; const estavaOff = alvo.dataset.off === 'true';
    const lista = new Set(cfgAtual.skills?.desativadas || []);
    if (estavaOff) lista.delete(nome); else lista.add(nome);
    try { await postar('/api/config', { skills: { desativadas: [...lista] } }); await recarregar(); abrirAba('skills'); marcarSistema(estavaOff ? 'Skill ativada.' : 'Skill desativada.'); } catch (ex) { marcarSistema('Erro: ' + ex.message); }
    return;
  }
  if (alvo.classList.contains('vercorpo')) {
    const pre = alvo.closest('.cardapi').querySelector('.corposkill');
    try { const r = await getJson('/api/skills/' + encodeURIComponent(alvo.dataset.nome)); pre.textContent = r.corpo; pre.classList.toggle('hidden'); } catch (ex) { pre.textContent = 'Erro: ' + ex.message; pre.classList.remove('hidden'); }
    return;
  }
  if (alvo.classList.contains('addlink')) { cfgAtual.links = cfgAtual.links || []; try { await postar('/api/config', { links: [...cfgAtual.links, { nome: '', url: '', nota: '' }] }); await recarregar(); abrirAba('links'); } catch (ex) { marcarSistema('Erro: ' + ex.message); } return; }
  if (alvo.classList.contains('salvarlinks')) return salvarLinks();
  if (alvo.classList.contains('rmlink')) {
    const i = Number(alvo.dataset.i); const lks = [...(cfgAtual.links || [])]; lks.splice(i, 1);
    try { await postar('/api/config', { links: lks }); await recarregar(); abrirAba('links'); } catch (ex) { marcarSistema('Erro: ' + ex.message); }
    return;
  }
  if (alvo.classList.contains('salvar') && alvo.dataset.secao) return trocarSenha(alvo);
});

jc('#configBtn').addEventListener('click', async () => { await recarregar().catch(() => {}); abrirAba(abaAtiva); jc('#janelaconfig').showModal(); });
jc('#configFechar').addEventListener('click', () => jc('#janelaconfig').close());

// deep-link: #config abre a janela; #config-<aba> abre direto na aba (ex.: #config-skills)
window.addEventListener('load', async () => {
  if (!location.hash.startsWith('#config')) return;
  const aba = location.hash.replace('#config-', '').replace('#config', '');
  const validas = ['apis', 'senhas', 'skills', 'comandos', 'mcp', 'plugins', 'links'];
  try { await recarregar(); } catch (e) {}
  try { abrirAba(validas.includes(aba) ? aba : 'apis'); } catch (e) {}
  jc('#janelaconfig').showModal();
});
