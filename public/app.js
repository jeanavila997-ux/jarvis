'use strict';
const $ = s => document.querySelector(s);
const msgs = $('#msgs'), entrada = $('#entrada'), form = $('#form'), btn = $('#enviar');
let conversaId = null, ocupado = false;

const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function inline(t) {
  return t.replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '<span class="wl">[[$1]]</span>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}
function md(src) {
  const linhas = esc(src).split('\n'); let html = '', lista = null, pre = false, tabela = false;
  const fecha = () => { if (lista) { html += `</${lista}>`; lista = null; } if (tabela) { html += '</table>'; tabela = false; } };
  for (const l of linhas) {
    if (l.startsWith('```')) { fecha(); html += pre ? '</pre>' : '<pre>'; pre = !pre; continue; }
    if (pre) { html += l + '\n'; continue; }
    let m;
    if (/^\s*\|.*\|\s*$/.test(l)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) continue;
      if (lista) { html += `</${lista}>`; lista = null; }
      if (!tabela) { html += '<table>'; tabela = true; }
      html += '<tr>' + l.trim().slice(1, -1).split('|').map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>'; continue;
    }
    if ((m = l.match(/^#{1,6}\s+(.*)/))) { fecha(); html += `<h4>${inline(m[1])}</h4>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (tabela) { html += '</table>'; tabela = false; } if (lista !== 'ul') { if (lista) html += `</${lista}>`; html += '<ul>'; lista = 'ul'; } html += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (tabela) { html += '</table>'; tabela = false; } if (lista !== 'ol') { if (lista) html += `</${lista}>`; html += '<ol>'; lista = 'ol'; } html += `<li>${inline(m[1])}</li>`; continue; }
    fecha();
    if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  fecha(); if (pre) html += '</pre>';
  return html;
}

function bolha(role, texto = '') {
  msgs.querySelector('.boas')?.remove();
  const d = document.createElement('div'); d.className = `msg ${role}`;
  const c = document.createElement('div'); c.className = 'conteudo';
  if (role === 'user') c.textContent = texto; else c.innerHTML = md(texto);
  d.append(c); msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d;
}
function rodape(d, fontes, erro) {
  if (fontes?.length) { const f = document.createElement('div'); f.className = 'fontes'; f.title = 'Notas do vault enviadas como contexto';
    for (const n of fontes) { const s = document.createElement('span'); s.textContent = n; f.append(s); } d.append(f); }
  if (erro) { d.classList.add('erro'); const e = document.createElement('div'); e.className = 'erromsg'; e.textContent = '⚠ ' + erro; d.append(e); }
}

async function api(url, op) { const r = await fetch(url, op); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`); return r.json(); }

async function carregarLista() {
  try {
    const l = await api('/api/conversas'); const ul = $('#lista'); ul.innerHTML = '';
    for (const c of l) { const li = document.createElement('li'); li.textContent = c.titulo || '(sem título)'; li.title = new Date(c.atualizado).toLocaleString('pt-BR');
      if (c.id === conversaId) li.className = 'ativa'; li.onclick = () => abrir(c.id); ul.append(li); }
  } catch (e) { $('#status').textContent = 'Erro ao listar: ' + e.message; }
}
async function abrir(id) {
  const c = await api('/api/conversas/' + id); conversaId = id; msgs.innerHTML = '';
  for (const m of c.mensagens) { const d = bolha(m.role, m.content); if (m.role === 'assistant') rodape(d, m.fontes, m.erro); }
  $('#lateral').classList.remove('aberta'); carregarLista();
}
async function saude() {
  try { const s = await api('/api/saude'); $('#modelo').textContent = s.modelo; $('#status').textContent = `Vault: ${s.notas} notas · ${s.trechos} trechos`; }
  catch (e) { $('#status').textContent = 'Servidor indisponível: ' + e.message; }
}

async function enviar(texto) {
  if (ocupado || !texto.trim()) return;
  ocupado = true; btn.disabled = true; entrada.value = ''; ajustar();
  bolha('user', texto);
  const d = bolha('assistant'); const c = d.querySelector('.conteudo');
  c.innerHTML = '<span class="pensando">Consultando o vault</span>';
  let resp = '', fontes = [], erro = null;
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify({ conversaId, mensagem: texto }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || `HTTP ${r.status}`);
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const ev = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        if (ev.tipo === 'inicio') { conversaId = ev.conversaId; fontes = ev.fontes; $('#modelo').textContent = ev.modelo; }
        else if (ev.tipo === 'fontes') fontes = ev.fontes;
        else if (ev.tipo === 'pensando' && !resp) c.innerHTML = '<span class="pensando">Pensando</span>';
        else if (ev.tipo === 'delta') { resp += ev.texto; c.innerHTML = md(resp); msgs.scrollTop = msgs.scrollHeight; }
        else if (ev.tipo === 'erro') erro = ev.mensagem;
      }
    }
  } catch (e) { erro = 'Falha na conexão: ' + e.message; }
  if (!resp) c.innerHTML = '';
  rodape(d, fontes, erro); msgs.scrollTop = msgs.scrollHeight;
  ocupado = false; btn.disabled = false; entrada.focus(); carregarLista();
}

function ajustar() { entrada.style.height = 'auto'; entrada.style.height = Math.min(entrada.scrollHeight, 180) + 'px'; }
entrada.addEventListener('input', ajustar);
entrada.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(max-width:760px)').matches) { e.preventDefault(); enviar(entrada.value); } });
form.addEventListener('submit', e => { e.preventDefault(); enviar(entrada.value); });
msgs.addEventListener('click', e => { if (e.target.matches('.sugestoes button')) enviar(e.target.textContent); });
$('#nova').onclick = () => { conversaId = null; location.reload(); };
$('#menu').onclick = () => $('#lateral').classList.toggle('aberta');
saude(); carregarLista();
