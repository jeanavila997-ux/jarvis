#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
// Ponte Codex → JARVIS. Sem dependências. Node ≥ 18.
// Uso: node codex/bin/jarvis-ask.mjs "pergunta"
//      node codex/bin/jarvis-ask.mjs saude | hermes
// Variáveis: JARVIS_URL, JARVIS_USER, JARVIS_PASS, JARVIS_TIMEOUT_MS
// A senha nunca é impressa. Não use --pass nem coloque credencial na URL.

const URL_VPS = 'https://jarvis.72-62-11-116.sslip.io';
const GETS = {
  saude: '/api/saude',
  hermes: '/api/hermes',
};

export function ehLoopback(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const h = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0:0:0:0:0:0:0:1';
}

export function validarDestino(urlStr, { user = '', pass = '' } = {}) {
  const u = new URL(urlStr);
  if (u.username || u.password) {
    const err = new Error('Não aceite usuário/senha na URL. Use JARVIS_USER e JARVIS_PASS.');
    err.codigo = 2;
    throw err;
  }
  const temCred = Boolean(user || pass);
  if (u.protocol === 'http:' && temCred && !ehLoopback(urlStr)) {
    const err = new Error('Recuso http:// com senha fora do loopback (a senha viajaria sem criptografia). Use https:// ou um endereço local (127.0.0.1).');
    err.codigo = 2;
    throw err;
  }
  return u.origin + u.pathname.replace(/\/$/, '');
}

export function juntarNdjson(texto) {
  const eventos = [];
  let resposta = '';
  let conversaId = null;
  let erro = null;
  let fontes = [];
  let rota = null;
  for (const linha of String(texto).split(/\r?\n/)) {
    if (!linha.trim()) continue;
    let ev;
    try { ev = JSON.parse(linha); } catch { continue; }
    eventos.push(ev);
    if (ev.tipo === 'inicio' && ev.conversaId) conversaId = ev.conversaId;
    if (ev.tipo === 'rota') rota = ev;
    if (ev.tipo === 'delta' && ev.texto) resposta += ev.texto;
    if (ev.tipo === 'fontes' && Array.isArray(ev.fontes)) fontes = ev.fontes;
    if (ev.tipo === 'erro') erro = ev.mensagem || ev.erro || 'erro';
  }
  return { resposta, conversaId, erro, fontes, rota, eventos };
}

export function cabecalhos({ user = '', pass = '', post = false } = {}) {
  const h = { accept: 'application/json' };
  if (post) {
    h['X-Jarvis'] = '1';
    h['content-type'] = 'application/json';
  }
  if (user || pass) h.Authorization = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
  return h;
}

function ajuda() {
  return `Uso:
  node codex/bin/jarvis-ask.mjs "pergunta"
  node codex/bin/jarvis-ask.mjs --json --conversa <id> "pergunta"
  node codex/bin/jarvis-ask.mjs saude
  node codex/bin/jarvis-ask.mjs hermes

Env: JARVIS_URL (padrão: ${URL_VPS}), JARVIS_USER (padrão: jean), JARVIS_PASS, JARVIS_TIMEOUT_MS.
A senha nunca é impressa. No PC local: JARVIS_URL=http://127.0.0.1:3200 (sem senha).
Existe um CLI mais completo na branch cli (cli/jarvis.mjs); este script não depende dela.`;
}

function parseArgs(argv) {
  const out = { json: false, conversa: '', pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--json') out.json = true;
    else if (a === '--conversa') {
      out.conversa = String(argv[++i] || '').trim();
      if (!out.conversa) throw Object.assign(new Error('Faltou o id em --conversa'), { codigo: 2 });
    } else if (a === '--pass' || a === '--password') {
      throw Object.assign(new Error('A flag --pass foi recusada (a senha apareceria no histórico). Use JARVIS_PASS.'), { codigo: 2 });
    } else if (a.startsWith('-')) {
      throw Object.assign(new Error(`Opção desconhecida: ${a}`), { codigo: 2 });
    } else out.pos.push(a);
  }
  return out;
}

function destinoDeEnv(env = process.env) {
  const url = (env.JARVIS_URL || URL_VPS).trim();
  const user = (env.JARVIS_USER || (url.includes('sslip.io') ? 'jean' : '')).trim();
  const pass = env.JARVIS_PASS || '';
  return { base: validarDestino(url, { user, pass }), user, pass };
}

async function pedir(base, path, { method = 'GET', body, user, pass, timeoutMs }) {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(base + path, {
      method,
      headers: cabecalhos({ user, pass, post: method !== 'GET' }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: ctrl.signal,
    });
    const texto = await r.text();
    if (r.status === 401) {
      const err = new Error(`Acesso recusado (HTTP 401) em ${path}. Confira JARVIS_USER e JARVIS_PASS. Não mostro a senha.`);
      err.codigo = 1;
      throw err;
    }
    if (!r.ok) {
      let msg = texto.slice(0, 300);
      try { const j = JSON.parse(texto); if (j.erro) msg = j.erro; } catch {}
      const err = new Error(`JARVIS respondeu HTTP ${r.status}: ${msg}`);
      err.codigo = 1;
      throw err;
    }
    return { texto, tipo: r.headers.get('content-type') || '' };
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error(`Tempo esgotado ao chamar ${path}`), { codigo: 1 });
    throw e;
  } finally { clearTimeout(tm); }
}

export async function main(argv = process.argv.slice(2), env = process.env, io = { stdout: process.stdout, stderr: process.stderr }) {
  let args;
  try { args = parseArgs(argv); } catch (e) { io.stderr.write(e.message + '\n'); return e.codigo || 2; }
  if (args.help || args.pos.length === 0) { io.stdout.write(ajuda() + '\n'); return args.help ? 0 : 2; }

  let dest;
  try { dest = destinoDeEnv(env); } catch (e) { io.stderr.write(e.message + '\n'); return e.codigo || 2; }

  const timeoutMs = Number(env.JARVIS_TIMEOUT_MS || 180000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    io.stderr.write('JARVIS_TIMEOUT_MS deve ser um número positivo.\n');
    return 2;
  }

  const cmd = args.pos[0];
  if (GETS[cmd] && args.pos.length === 1) {
    const r = await pedir(dest.base, GETS[cmd], { user: dest.user, pass: dest.pass, timeoutMs: Math.min(timeoutMs, 20000) });
    if (args.json) io.stdout.write(r.texto.trim() + '\n');
    else {
      try {
        const j = JSON.parse(r.texto);
        io.stdout.write((j.texto || JSON.stringify(j, null, 2)) + '\n');
      } catch { io.stdout.write(r.texto.trim() + '\n'); }
    }
    return 0;
  }

  const mensagem = args.pos.join(' ').trim();
  const corpo = { mensagem };
  if (args.conversa) corpo.conversaId = args.conversa;
  const r = await pedir(dest.base, '/api/chat', {
    method: 'POST', body: corpo, user: dest.user, pass: dest.pass, timeoutMs,
  });
  const out = juntarNdjson(r.texto);
  if (args.json) io.stdout.write(JSON.stringify(out, null, 2) + '\n');
  else {
    if (out.resposta) io.stdout.write(out.resposta.replace(/\s*$/, '\n'));
    else io.stdout.write('(sem texto na resposta)\n');
  }
  if (out.erro) { io.stderr.write(`Aviso do JARVIS: ${out.erro}\n`); return 1; }
  return 0;
}

const invocacao = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invocacao) {
  main().then(c => process.exit(c)).catch(e => {
    process.stderr.write((e.message || String(e)) + '\n');
    process.exit(e.codigo || 1);
  });
}
