// JARVIS v0.1 — servidor de chat (Node 22, sem dependências externas).
import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Indice } from './src/retrieval.mjs';
import { montarPrompt } from './src/prompt.proposta.mjs';
import { criarTelegram } from './src/telegram.mjs';
import { auditar } from './src/auditoria.mjs';

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '0.0.0.0';
const MODEL = process.env.JARVIS_MODEL || 'glm-5.3-flash';
const OLLAMA_URL = (process.env.OLLAMA_URL || 'https://ollama.com').replace(/\/$/, '');
const API_KEY = process.env.OLLAMA_API_KEY || '';
const VAULT_DIR = process.env.VAULT_DIR || './vault';
const DATA_DIR = process.env.DATA_DIR || './data';
const CONV_DIR = path.join(DATA_DIR, 'conversas');
const MAX_HIST = Number(process.env.JARVIS_MAX_HISTORICO || 12);
const TIMEOUT_MS = Number(process.env.JARVIS_TIMEOUT_MS || 180000);
const INICIO = Date.now();
const PUBLIC = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');

const indice = new Indice(VAULT_DIR);
await mkdir(CONV_DIR, { recursive: true });
const r = await indice.reindexar();
console.log(`[jarvis] vault indexado: ${r.notas} notas, ${r.trechos} trechos, ${r.ignorados.length} ignorados`);
if (!API_KEY) console.warn('[jarvis] AVISO: OLLAMA_API_KEY ausente — o chat vai mostrar erro.');

const agoraAcre = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco', dateStyle: 'full', timeStyle: 'short' });
const idValido = id => /^[a-f0-9-]{36}$/.test(id || '');
const arqConv = id => path.join(CONV_DIR, `${id}.json`);

async function lerConv(id) { return JSON.parse(await readFile(arqConv(id), 'utf8')); }
async function salvarConv(c) {
  const tmp = arqConv(c.id) + '.tmp';
  await writeFile(tmp, JSON.stringify(c, null, 1)); await rename(tmp, arqConv(c.id));
}
async function listarConvs() {
  const out = [];
  for (const f of await readdir(CONV_DIR)) {
    if (!f.endsWith('.json')) continue;
    try { const c = JSON.parse(await readFile(path.join(CONV_DIR, f), 'utf8')); out.push({ id: c.id, titulo: c.titulo, atualizado: c.atualizado, n: c.mensagens.length }); } catch {}
  }
  return out.sort((a, b) => b.atualizado.localeCompare(a.atualizado));
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function corpo(req, limite = 64 * 1024) {
  let s = ''; for await (const ch of req) { s += ch; if (s.length > limite) throw new Error('corpo grande demais'); }
  return s ? JSON.parse(s) : {};
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
async function estatico(res, p) {
  const nome = p === '/' ? 'index.html' : p.slice(1);
  if (!/^[\w.-]+$/.test(nome)) return json(res, 404, { erro: 'não encontrado' });
  try {
    const buf = await readFile(path.join(PUBLIC, nome));
    res.writeHead(200, { 'content-type': TIPOS[path.extname(nome)] || 'application/octet-stream', 'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
    res.end(buf);
  } catch { json(res, 404, { erro: 'não encontrado' }); }
}

// Núcleo compartilhado (web e Telegram): busca no vault + Ollama Cloud. Sem fallback.
async function perguntar(conv, texto, { onDelta = () => {}, onPensando = () => {}, signal } = {}) {
  conv.mensagens.push({ role: 'user', content: texto, ts: new Date().toISOString() });
  conv.atualizado = new Date().toISOString();
  await salvarConv(conv);

  // Busca usa a pergunta atual + a anterior (para perguntas de continuação).
  const usuarios = conv.mensagens.filter(m => m.role === 'user').slice(-2).map(m => m.content).join('\n');
  const trechos = indice.buscar(usuarios);
  const fontes = [...new Set(trechos.map(t => t.nota))];
  const historico = conv.mensagens.filter(m => !m.erro && m.content).slice(-MAX_HIST).map(({ role, content }) => ({ role, content }));
  const mensagens = [{ role: 'system', content: montarPrompt(trechos, agoraAcre()) }, ...historico];

  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => ctrl.abort());
  let resposta = '', erro = null, pensou = false;
  try {
    if (!API_KEY) throw new Error('OLLAMA_API_KEY não configurada no .env do JARVIS.');
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages: mensagens, stream: true }),
    });
    if (!r.ok) {
      let msg = await r.text().catch(() => '');
      try { msg = JSON.parse(msg).error || msg; } catch {}
      throw new Error(`Ollama Cloud respondeu HTTP ${r.status}: ${String(msg).slice(0, 300)}`);
    }
    const dec = new TextDecoder(); let buf = '';
    for await (const pedaco of r.body) {
      buf += dec.decode(pedaco, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!linha) continue;
        const j = JSON.parse(linha);
        if (j.error) throw new Error(`Ollama Cloud: ${j.error}`);
        if (j.message?.thinking && !pensou) { pensou = true; onPensando(); }
        if (j.message?.content) { resposta += j.message.content; onDelta(j.message.content); }
      }
      clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    }
    if (!resposta) throw new Error('O modelo terminou sem resposta.');
  } catch (e) {
    erro = e.name === 'AbortError' ? 'Tempo esgotado ou conexão interrompida com o Ollama Cloud.' : e.message;
    console.error('[jarvis] erro no chat:', erro);
  } finally { clearTimeout(timer); }

  conv.mensagens.push({ role: 'assistant', content: resposta, ts: new Date().toISOString(), modelo: MODEL, fontes, ...(erro ? { erro } : {}) });
  conv.atualizado = new Date().toISOString();
  await salvarConv(conv);
  return { resposta, fontes, erro };
}

const novaConv = (titulo, extra = {}) => ({ id: randomUUID(), titulo: titulo.slice(0, 60), criado: new Date().toISOString(), atualizado: new Date().toISOString(), mensagens: [], ...extra });

async function chat(req, res) {
  const b = await corpo(req);
  const texto = String(b.mensagem || '').trim();
  if (!texto) return json(res, 400, { erro: 'mensagem vazia' });
  if (texto.length > 8000) return json(res, 400, { erro: 'mensagem longa demais (máx. 8000 caracteres)' });

  let conv;
  if (idValido(b.conversaId)) { try { conv = await lerConv(b.conversaId); } catch {} }
  if (!conv) conv = novaConv(texto);

  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
  const enviar = o => res.write(JSON.stringify(o) + '\n');
  const ctrl = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ctrl.abort(); });
  enviar({ tipo: 'inicio', conversaId: conv.id, modelo: MODEL, fontes: [] });
  const { fontes, erro } = await perguntar(conv, texto, {
    signal: ctrl.signal,
    onPensando: () => enviar({ tipo: 'pensando' }),
    onDelta: t => enviar({ tipo: 'delta', texto: t }),
  });
  enviar({ tipo: 'fontes', fontes });
  if (erro) enviar({ tipo: 'erro', mensagem: erro });
  enviar({ tipo: 'fim' });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    // Proteção contra CSRF: todo POST precisa do cabeçalho X-Jarvis (força preflight CORS).
    if (req.method === 'POST' && req.headers['x-jarvis'] !== '1') return json(res, 403, { erro: 'cabeçalho X-Jarvis ausente' });
    if (p === '/api/saude' && req.method === 'GET') return json(res, 200, { ok: true, versao: '0.1.0', modelo: MODEL, notas: indice.notas, trechos: indice.chunks.length, ignorados: indice.ignorados, indexado: indice.atualizado });
    if (p === '/api/conversas' && req.method === 'GET') return json(res, 200, await listarConvs());
    if (p.startsWith('/api/conversas/') && req.method === 'GET') {
      const id = p.split('/')[3];
      if (!idValido(id)) return json(res, 400, { erro: 'id inválido' });
      try { return json(res, 200, await lerConv(id)); } catch { return json(res, 404, { erro: 'conversa não encontrada' }); }
    }
    if (p === '/api/chat' && req.method === 'POST') return await chat(req, res);
    if (p === '/api/reindexar' && req.method === 'POST') return json(res, 200, await indice.reindexar());
    if (req.method === 'GET' && !p.startsWith('/api/')) return await estatico(res, p);
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    console.error('[jarvis]', e);
    if (!res.headersSent) json(res, 500, { erro: e.message }); else res.end();
  }
});
server.listen(PORT, HOST, () => console.log(`[jarvis] ouvindo em ${HOST}:${PORT} · modelo ${MODEL} via ${OLLAMA_URL}`));
const telegram = criarTelegram({
  token: process.env.TELEGRAM_BOT_TOKEN, chatPermitido: process.env.TELEGRAM_ALLOWED_CHAT_ID, dataDir: DATA_DIR,
  perguntar, lerConv, novaConv, auditar: e => auditar(DATA_DIR, e),
  status: () => ({ uptimeS: Math.round((Date.now() - INICIO) / 1000), modelo: MODEL, notas: indice.notas, trechos: indice.chunks.length, indexado: indice.atualizado }),
});
telegram?.iniciar();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { telegram?.parar(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
