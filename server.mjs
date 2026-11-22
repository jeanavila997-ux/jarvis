// JARVIS v0.1 — servidor de chat (Node 22, sem dependências externas).
import http from 'node:http';
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Indice } from './src/retrieval.mjs';
import { montarPrompt, montarPromptLocal } from './src/prompt.proposta.mjs';
import { chatOllama } from './src/llm.mjs';
import { nivelPorRegras, avisoGuarda } from './src/permissoes.mjs';
import { classificar } from './src/classificador.mjs';
import { criarRoteador } from './src/roteador.mjs';
import { responderPorRegras } from './src/regras.mjs';
import { registrarUso, resumoUso } from './src/uso.mjs';
import { criarReserva } from './src/reserva9router.mjs';
import { criarTelegram } from './src/telegram.mjs';
import { criarRotinas } from './src/rotinas.mjs';
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
// Roteador (Etapa 1). Local desligado se JARVIS_LOCAL_URL vazio.
const LOCAL_URL = (process.env.JARVIS_LOCAL_URL || '').replace(/\/$/, '');
const LOCAL_MODEL = process.env.JARVIS_LOCAL_MODEL || 'llama3.2:3b';
const LOCAL_TIMEOUT_MS = Number(process.env.JARVIS_LOCAL_TIMEOUT_MS || 60000);
const CLASSIF_TIMEOUT_MS = Number(process.env.JARVIS_CLASSIF_TIMEOUT_MS || 20000);
// Reserva 9Router (PC do Jean): desligada por padrão; só depois que a nuvem falhar.
const reserva = criarReserva({ ligada: process.env.NINEROUTER_RESERVA === '1', url: process.env.NINEROUTER_URL, model: process.env.NINEROUTER_MODEL,
  apiKey: process.env.NINEROUTER_API_KEY, timeoutMs: Number(process.env.NINEROUTER_TIMEOUT_MS || 20000) });
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

// Núcleo compartilhado (web e Telegram): regras → Guarda → roteador (local/nuvem) → plano B.
const roteador = criarRoteador({
  localUrl: LOCAL_URL, localModel: LOCAL_MODEL,
  classificar: texto => classificar(texto, { url: LOCAL_URL, model: LOCAL_MODEL, timeoutMs: CLASSIF_TIMEOUT_MS }),
  log: m => console.warn('[roteador]', m),
});
const statusAtual = () => ({ uptimeS: Math.round((Date.now() - INICIO) / 1000), modelo: MODEL, local: roteador.localLigado, localModelo: LOCAL_MODEL, reserva: reserva.ativa ? reserva.model : null, notas: indice.notas, trechos: indice.chunks.length, indexado: indice.atualizado });
const ctxRegras = { status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias) };

function planoBRegras(trechos, erroNuvem) {
  const notas = [...new Set(trechos.map(t => t.nota))].slice(0, 5);
  return `Não consegui falar com a nuvem agora, e não uso fallback pago. Resposta por regras, sem IA:\n` +
    (notas.length ? `As notas do vault mais ligadas à sua pergunta são: ${notas.map(n => `[[${n}]]`).join(' · ')}.` : 'Não achei notas do vault ligadas a essa pergunta.') +
    `\nTente de novo em alguns minutos. (Motivo: ${erroNuvem})`;
}

async function perguntar(conv, texto, { onDelta = () => {}, onPensando = () => {}, onRota = () => {}, signal, canal = 'web' } = {}) {
  const t0 = Date.now();
  conv.mensagens.push({ role: 'user', content: texto, ts: new Date().toISOString() });
  conv.atualizado = new Date().toISOString();
  await salvarConv(conv);

  // Guarda: nível decidido só por regras do PERMISSOES.md (nunca pelo classificador).
  const guarda = nivelPorRegras(texto);
  if (guarda.nivel >= 1) auditar(DATA_DIR, { canal, nivel: guarda.nivel, acao: 'pedido-detectado', motivo: guarda.motivos.join(', '), conversa: conv.id, resultado: 'sem-ferramenta-ligada' });

  let resposta = '', erro = null, fontes = [], modelo = 'regras', tokensIn = null, tokensOut = null;
  let dec = { rota: 'regras', motivo: '', nivel: guarda.nivel };

  const regra = guarda.nivel === 0 ? await responderPorRegras(texto, ctxRegras) : null;
  if (regra) {
    dec.motivo = `regra-${regra.regra}`; resposta = regra.texto;
    onRota({ rota: 'regras', modelo: 'regras' }); onDelta(resposta);
  } else {
    // Busca usa a pergunta atual + a anterior (para perguntas de continuação).
    const usuarios = conv.mensagens.filter(m => m.role === 'user').slice(-2).map(m => m.content).join('\n');
    const trechos = indice.buscar(usuarios);
    fontes = [...new Set(trechos.map(t => t.nota))];
    const historico = conv.mensagens.filter(m => !m.erro && m.content).slice(-MAX_HIST).map(({ role, content }) => ({ role, content }));
    dec = await roteador.decidir(texto, guarda);

    if (dec.rota === 'local') {
      onRota({ rota: 'local', modelo: LOCAL_MODEL });
      let emitiu = false;
      try {
        const r = await chatOllama({ url: LOCAL_URL, model: LOCAL_MODEL, nome: 'Ollama local', signal, timeoutMs: LOCAL_TIMEOUT_MS, keepAlive: '30m',
          options: { temperature: 0.4, num_predict: 300, num_ctx: 4096 },
          messages: [{ role: 'system', content: montarPromptLocal(trechos, agoraAcre()) }, ...historico.slice(-6)],
          onDelta: t => { emitiu = true; onDelta(t); } });
        if (!r.resposta.trim()) throw new Error('modelo local terminou sem resposta');
        ({ resposta, tokensIn, tokensOut } = r); modelo = LOCAL_MODEL;
      } catch (e) {
        if (emitiu || signal?.aborted) { resposta = e.parcial || ''; erro = e.message; modelo = LOCAL_MODEL; }
        else { console.warn('[roteador] plano B: local falhou (' + e.message + ') → nuvem'); dec = { ...dec, rota: 'nuvem', motivo: 'plano-b-local-falhou', erroLocal: e.message }; }
      }
    }

    if (dec.rota === 'nuvem') {
      onRota({ rota: 'nuvem', modelo: MODEL });
      const mensagens = [{ role: 'system', content: montarPrompt(trechos, agoraAcre()) + avisoGuarda(guarda) }, ...historico];
      let emitiu = false;
      try {
        if (!API_KEY) throw new Error('OLLAMA_API_KEY não configurada no .env do JARVIS.');
        const r = await chatOllama({ url: OLLAMA_URL, apiKey: API_KEY, model: MODEL, messages: mensagens, signal, timeoutMs: TIMEOUT_MS, nome: 'Ollama Cloud',
          onPensando, onDelta: t => { emitiu = true; onDelta(t); } });
        if (!r.resposta) throw new Error('O modelo terminou sem resposta.');
        ({ resposta, tokensIn, tokensOut } = r); modelo = MODEL;
      } catch (e) {
        erro = e.message; modelo = MODEL;
        console.error('[jarvis] erro no chat (nuvem):', erro);
        if (emitiu || signal?.aborted) resposta = e.parcial || '';
        else {
          let feito = false;
          // Reserva 9Router (opcional, desligada por padrão): health sem custo antes de tentar.
          if (reserva.ativa && await reserva.saudavel()) {
            onRota({ rota: 'reserva-9router', modelo: reserva.model });
            let emitiuR = false;
            try {
              const r = await reserva.chat({ messages: mensagens, signal, onDelta: t => { emitiuR = true; onDelta(t); } });
              ({ resposta, tokensIn, tokensOut } = r); modelo = reserva.model; feito = true;
              dec = { ...dec, rota: 'reserva-9router', motivo: 'nuvem-falhou', erroNuvem: erro }; erro = null;
            } catch (e2) {
              console.warn('[roteador] reserva 9Router falhou:', e2.message);
              if (emitiuR) { resposta = e2.parcial || ''; erro = e2.message; modelo = reserva.model; feito = true; dec = { ...dec, rota: 'reserva-9router', motivo: 'nuvem-falhou' }; }
              else erro = `${erro} | ${e2.message}`;
            }
          }
          if (!feito) { // Plano B fixo: resposta por regras, sem IA e sem custo. Nunca outro serviço pago.
            resposta = planoBRegras(trechos, erro); onDelta(resposta);
            dec = { ...dec, rota: 'plano-b-regras', motivo: 'plano-b-nuvem-falhou' }; modelo = 'regras';
          }
        }
      }
    }
  }

  const ms = Date.now() - t0;
  conv.mensagens.push({ role: 'assistant', content: resposta, ts: new Date().toISOString(), modelo, rota: dec.rota, fontes, ...(erro ? { erro } : {}) });
  conv.atualizado = new Date().toISOString();
  await salvarConv(conv);
  await registrarUso(DATA_DIR, { canal, rota: dec.rota, modelo, motivo: dec.motivo, nota: dec.nota ?? null, tipo: dec.tipo ?? null, nivel: guarda.nivel,
    ms, classif_ms: dec.classifMs ?? null, tokens_in: tokensIn, tokens_out: tokensOut, classif_tokens: dec.classifTokens ?? null,
    ...(dec.erroLocal ? { erro_local: dec.erroLocal.slice(0, 200) } : {}), ...(dec.erroNuvem ? { erro_nuvem: dec.erroNuvem.slice(0, 200) } : {}), ...(erro ? { erro: erro.slice(0, 200) } : {}) });
  return { resposta, fontes, erro, rota: dec.rota, modelo };
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
    signal: ctrl.signal, canal: 'web',
    onRota: r => enviar({ tipo: 'rota', ...r }),
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
    if (p === '/api/saude' && req.method === 'GET') return json(res, 200, { ok: true, versao: '0.2.0', modelo: MODEL, local: roteador.localLigado ? LOCAL_MODEL : null, notas: indice.notas, trechos: indice.chunks.length, ignorados: indice.ignorados, indexado: indice.atualizado });
    if (p === '/api/custo' && req.method === 'GET') return json(res, 200, { hoje: await resumoUso(DATA_DIR, 1), semana: await resumoUso(DATA_DIR, 7) });
    if (p === '/api/conversas' && req.method === 'GET') return json(res, 200, await listarConvs());
    if (p.startsWith('/api/conversas/') && req.method === 'GET') {
      const id = p.split('/')[3];
      if (!idValido(id)) return json(res, 400, { erro: 'id inválido' });
      try { return json(res, 200, await lerConv(id)); } catch { return json(res, 404, { erro: 'conversa não encontrada' }); }
    }
    if (p === '/api/chat' && req.method === 'POST') return await chat(req, res);
    if (p === '/api/reindexar' && req.method === 'POST') return json(res, 200, await indice.reindexar());
    if (p === '/api/rotinas' && req.method === 'GET') return json(res, 200, rotinas ? { ativo: true, ...rotinas.dados() } : { ativo: false });
    if (req.method === 'GET' && !p.startsWith('/api/')) return await estatico(res, p);
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    console.error('[jarvis]', e);
    if (!res.headersSent) json(res, 500, { erro: e.message }); else res.end();
  }
});
server.listen(PORT, HOST, () => console.log(`[jarvis] ouvindo em ${HOST}:${PORT} · nuvem ${MODEL} via ${OLLAMA_URL} · local ${roteador.localLigado ? LOCAL_MODEL : 'desligado'}`));
const telegram = criarTelegram({
  token: process.env.TELEGRAM_BOT_TOKEN, chatPermitido: process.env.TELEGRAM_ALLOWED_CHAT_ID, dataDir: DATA_DIR,
  perguntar, lerConv, novaConv, auditar: e => auditar(DATA_DIR, e),
  status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias),
});
const rotinas = telegram ? criarRotinas({
  dataDir: DATA_DIR, chatPermitido: process.env.TELEGRAM_ALLOWED_CHAT_ID, enviar: telegram.enviar,
  status: () => ({ modelo: MODEL, notas: indice.notas, trechos: indice.chunks.length }),
  auditar: e => auditar(DATA_DIR, e), indice,
}) : null;
telegram?.ligarRotinas(rotinas);
telegram?.iniciar();
await rotinas?.ligar();
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => { telegram?.parar(); rotinas?.parar(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
