#!/usr/bin/env node
// CLI do JARVIS — cliente HTTP, zero dependências, Node >= 18 (fetch nativo).
// Fala só com rotas que existem em server.mjs. Não inventa endpoint.

import { createInterface } from 'node:readline/promises';
import { stdin as stdinFd, stdout as stdoutFd, stderr as stderrFd } from 'node:process';
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const VERSAO = '0.2.0';
export const URL_LOCAL = 'http://127.0.0.1:3200';
export const URL_VPS = 'https://jarvis.72-62-11-116.sslip.io';
export const TIMEOUT_GET_MS = 20_000;
export const TIMEOUT_CHAT_MS = 180_000;

export const COMANDOS = new Set([
  'ask', 'chat', 'status', 'health', 'saude',
  'hermes', 'nvidia', 'mestre', 'voz', 'skills', 'custo', 'rotinas', 'conversas',
  'reindexar', 'config', 'help', 'ajuda', 'version', 'versao',
]);

const AJUDA = `CLI do JARVIS ${VERSAO} — fala com o assistente pelo terminal.

Uso:
  jarvis "pergunta"              Envia a pergunta (POST /api/chat)
  jarvis ask "pergunta"          Igual ao acima
  echo texto | jarvis            Lê a pergunta da entrada padrão
  jarvis chat                    Conversa interativa (mantém o id da conversa)
  jarvis health                  Saúde da API (GET /api/saude)
  jarvis status                  Saúde + custos (GET /api/saude e GET /api/custo)
  jarvis config                  Grava ~/.config/jarvis/config.json (no Windows: %APPDATA%\\jarvis)
  jarvis config show             Mostra a config, sem a senha

Outras leituras (rotas reais; algumas só existem na VPS / branch Voicebox):
  jarvis hermes | nvidia | mestre | voz | skills | custo | rotinas | conversas

Opções:
  --target local|vps   Qual instância usar (padrão: local, ou o "target" da config)
  --url URL            Sobrescreve o endereço
  --user USUARIO       Usuário do basic-auth (VPS, Traefik)
  --json               Saída em JSON (bom para script)
  --timeout MS         Tempo máximo, número positivo (padrão: 20s nas leituras, 180s no chat)
  --conversa UUID      Continua uma conversa já existente
  --no-color           Sem cores (também respeita a variável NO_COLOR)
  -h, --help           Esta ajuda
  -V, --version        Versão

Exemplos:
  jarvis health
  jarvis --target vps status
  jarvis "resumo do dia"
  jarvis chat --target local
  jarvis ask --json /status
  echo "/hermes" | jarvis --target vps

No chat interativo, /status /custo /hermes /nvidia /mestre /voz /skills /github /ajuda
vão para o JARVIS como mensagem (comandos com barra que ele já entende, ou o /github
quando essa integração estiver ligada). Comandos só do terminal:
  /nova   começa uma conversa nova
  /id     mostra o id da conversa atual
  /sair   encerra (também /exit, /quit)

Alvos:
  local  ${URL_LOCAL}   (sem senha, no seu PC)
  vps    ${URL_VPS}   (HTTPS + basic-auth)

A senha nunca é impressa. Use JARVIS_PASS ou "jarvis config" (arquivo com
permissão restrita). A flag --pass/--password é recusada: a senha apareceria
no histórico do terminal.

O CLI roda no Node 18 ou mais novo (fetch nativo). O servidor (server.mjs)
pede Node 22 — por isso o campo engines do package.json continua ">=22".

Variáveis de ambiente (ganham da config; as flags ganham das variáveis):
  JARVIS_URL  JARVIS_USER  JARVIS_PASS  JARVIS_TARGET  JARVIS_CONFIG  JARVIS_TIMEOUT_MS
`;

/* ------------------------------ cores ------------------------------ */

export function querCor({ json = false, noColor = false, tty = stdoutFd.isTTY } = {}) {
  if (json || noColor) return false;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR === '0') return false;
  return Boolean(tty);
}

export function paleta(liga) {
  const c = (code, s) => (liga ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    liga,
    dim: s => c(2, s),
    bold: s => c(1, s),
    cyan: s => c(36, s),
    green: s => c(32, s),
    yellow: s => c(33, s),
    red: s => c(31, s),
    gray: s => c(90, s),
  };
}

/* ------------------------------ args ------------------------------- */

export function parseArgs(argv) {
  const out = {
    comando: null,
    texto: '',
    target: null,
    url: null,
    user: null,
    json: false,
    noColor: false,
    timeout: null,
    conversa: null,
    help: false,
    version: false,
    configShow: false,
    resto: [],
  };
  const args = [...argv];
  const pos = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--') { pos.push(...args); break; }
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    if (a === '-V' || a === '--version') { out.version = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--no-color') { out.noColor = true; continue; }
    if (a === '--target' || a === '-t') { out.target = obrigatorio(args, a); continue; }
    if (a === '--url') { out.url = obrigatorio(args, a); continue; }
    if (a === '--user') { out.user = obrigatorio(args, a); continue; }
    if (a === '--pass' || a === '--password' || a.startsWith('--pass=') || a.startsWith('--password=')) {
      throw new ErroCli('A flag --pass/--password foi recusada porque a senha apareceria no histórico do terminal. Use a variável JARVIS_PASS ou "jarvis config".', 2);
    }
    if (a === '--timeout') { out.timeout = validarTimeout(obrigatorio(args, a), '--timeout'); continue; }
    if (a === '--conversa' || a === '--conversa-id') { out.conversa = obrigatorio(args, a); continue; }
    if (a.startsWith('--')) throw new ErroCli(`Opção desconhecida: ${a}. Use --help.`, 2);
    pos.push(a);
  }
  if (pos[0] && COMANDOS.has(pos[0])) {
    out.comando = pos.shift();
    if (out.comando === 'config' && pos[0] === 'show') {
      out.configShow = true;
      pos.shift();
    }
  }
  out.resto = pos;
  out.texto = pos.join(' ').trim();
  if (!out.comando && !out.help && !out.version && out.texto) out.comando = 'ask';
  if (out.target && out.target !== 'local' && out.target !== 'vps') {
    throw new ErroCli(`--target deve ser "local" ou "vps" (recebi "${out.target}").`, 2);
  }
  return out;
}

function obrigatorio(args, flag) {
  if (!args.length) throw new ErroCli(`A opção ${flag} precisa de um valor.`, 2);
  const prox = String(args[0]);
  // Aceita números negativos (ex.: --timeout -5) para recusá-los depois com a mensagem certa.
  if (prox.startsWith('-') && !/^-?\d+(\.\d+)?$/.test(prox)) {
    throw new ErroCli(`A opção ${flag} precisa de um valor.`, 2);
  }
  return args.shift();
}

export function validarTimeout(n, origem = '--timeout') {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new ErroCli(`${origem} deve ser um número positivo em milissegundos.`, 2);
  }
  return v;
}

/* ------------------------------ config ----------------------------- */

export function caminhoConfig(env = process.env) {
  if (env.JARVIS_CONFIG) return path.resolve(env.JARVIS_CONFIG);
  if (process.platform === 'win32') {
    const base = env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'jarvis', 'config.json');
  }
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, 'jarvis', 'config.json');
}

export function configVazia() {
  return {
    target: 'local',
    targets: {
      local: { url: URL_LOCAL },
      vps: { url: URL_VPS, user: 'jean' },
    },
  };
}

export async function carregarConfig(arquivo = caminhoConfig(), opts = {}) {
  try {
    const bruto = JSON.parse(await readFile(arquivo, 'utf8'));
    const base = configVazia();
    const vpsIn = bruto.targets?.vps || {};
    const montado = {
      target: bruto.target === 'vps' ? 'vps' : 'local',
      targets: {
        local: { ...base.targets.local, ...(bruto.targets?.local || {}), url: bruto.targets?.local?.url || bruto.urlLocal || URL_LOCAL },
        vps: {
          ...base.targets.vps,
          ...vpsIn,
          url: vpsIn.url || bruto.urlVps || URL_VPS,
          user: vpsIn.user || bruto.user || 'jean',
          ...(vpsIn.pass || bruto.pass ? { pass: vpsIn.pass || bruto.pass } : {}),
          ...(vpsIn.passDpapi ? { passDpapi: vpsIn.passDpapi } : {}),
        },
      },
    };
    const plataforma = opts.plataforma ?? protecaoConfig.plataforma();
    return await revelarSenhasConfig(montado, plataforma);
  } catch (e) {
    if (e && e.code === 'ENOENT') return configVazia();
    if (e instanceof ErroCli) throw e;
    throw new ErroCli(`Não consegui ler a config em ${arquivo}: ${e.message}`, 1);
  }
}

export function redigirConfig(cfg) {
  const c = structuredClone(cfg);
  const esconder = o => {
    if (!o || typeof o !== 'object') return;
    if (o.pass) o.pass = '***';
    if (o.passDpapi) o.passDpapi = '***';
  };
  for (const t of Object.values(c.targets || {})) esconder(t);
  esconder(c);
  return c;
}

// Ganchos trocáveis nos testes (no Windows real: icacls + DPAPI).
export const protecaoConfig = {
  plataforma: () => process.platform,
  protegerAcl: (...a) => protegerAclWindows(...a),
  cifrarDpapi: (...a) => cifrarSenhaDpapi(...a),
  decifrarDpapi: (...a) => decifrarSenhaDpapi(...a),
};

export function spawnSemShell(comando, args, { input = '', timeoutMs = 15000, env } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(comando, args, {
      shell: false,
      windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [], err = [];
    filho.stdout.on('data', d => out.push(d));
    filho.stderr.on('data', d => err.push(d));
    if (input) filho.stdin.write(input);
    filho.stdin.end();
    const t = setTimeout(() => { try { filho.kill(); } catch {} reject(new Error(`timeout ao executar ${comando}`)); }, timeoutMs);
    filho.on('error', e => { clearTimeout(t); reject(e); });
    filho.on('close', code => {
      clearTimeout(t);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8');
      if (code !== 0) reject(new Error((stderr || stdout || `exit ${code}`).trim()));
      else resolve(stdout);
    });
  });
}

function exePowershell() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export async function protegerAclWindows(caminho, { usuario, executar } = {}) {
  const user = usuario || process.env.USERNAME || os.userInfo().username;
  if (!user) throw new Error('USERNAME ausente: não consigo restringir o ACL com icacls.');
  const run = executar || spawnSemShell;
  // Sem shell: o nome do usuário vai como argumento, não como %USERNAME%.
  await run('icacls.exe', [path.resolve(caminho), '/inheritance:r', '/grant:r', `${user}:F`]);
}

export async function cifrarSenhaDpapi(senha, { executar } = {}) {
  const run = executar || spawnSemShell;
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$plain = [Console]::In.ReadToEnd()',
    '$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force',
    'ConvertFrom-SecureString -SecureString $secure',
  ].join('; ');
  const out = await run(exePowershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { input: String(senha) });
  const blob = out.trim();
  if (!blob) throw new Error('DPAPI não devolveu o blob.');
  return blob;
}

export async function decifrarSenhaDpapi(blob, { executar } = {}) {
  const run = executar || spawnSemShell;
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$enc = [Console]::In.ReadToEnd().Trim()',
    '$secure = ConvertTo-SecureString -String $enc',
    '$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)',
    'try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }',
  ].join('; ');
  const out = await run(exePowershell(), ['-NoProfile', '-NonInteractive', '-Command', script], { input: String(blob) });
  return out.replace(/\r?\n$/, '');
}

async function prepararConfigParaDisco(cfg, plataforma) {
  const out = structuredClone(cfg);
  if (plataforma !== 'win32') return out;
  for (const t of Object.values(out.targets || {})) {
    if (!t || !t.pass) continue;
    try {
      t.passDpapi = await protecaoConfig.cifrarDpapi(t.pass);
      delete t.pass;
    } catch {
      // Fallback: texto puro, mas o arquivo/pasta ficam com ACL do icacls.
    }
  }
  return out;
}

async function revelarSenhasConfig(cfg, plataforma) {
  const out = structuredClone(cfg);
  for (const t of Object.values(out.targets || {})) {
    if (!t || !t.passDpapi) continue;
    if (plataforma !== 'win32') continue;
    try {
      t.pass = await protecaoConfig.decifrarDpapi(t.passDpapi);
    } catch (e) {
      throw new ErroCli(`Não consegui decifrar a senha guardada com DPAPI: ${e.message}. Rode "jarvis config" de novo neste Windows, na mesma conta.`, 1);
    }
  }
  return out;
}

export async function salvarConfig(cfg, arquivo = caminhoConfig(), opts = {}) {
  const plataforma = opts.plataforma ?? protecaoConfig.plataforma();
  const dir = path.dirname(arquivo);
  await mkdir(dir, { recursive: true });
  const paraDisco = await prepararConfigParaDisco(cfg, plataforma);
  const tmp = arquivo + '.tmp';
  await writeFile(tmp, JSON.stringify(paraDisco, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, arquivo);
  if (plataforma === 'win32') {
    try { await protecaoConfig.protegerAcl(dir); } catch { /* ainda tentamos o arquivo */ }
    await protecaoConfig.protegerAcl(arquivo);
  } else {
    try { await chmod(dir, 0o700); } catch { /* ignore */ }
    try { await chmod(arquivo, 0o600); } catch { /* ignore */ }
  }
  return arquivo;
}

export function ehLoopback(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const h = (u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0:0:0:0:0:0:0:1';
}

export function avisoTlsInseguro(env = process.env) {
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED) === '0') {
    return 'Aviso: NODE_TLS_REJECT_UNAUTHORIZED=0 desliga a verificação do certificado TLS. Isso facilita um ataque de interceptação. Só use em teste, e nunca com a senha da VPS.';
  }
  return null;
}

export function validarUrlDestino({ target, url, user, pass }) {
  let u;
  try { u = new URL(url); } catch { throw new ErroCli(`URL inválida: ${url}`, 2); }
  const http = u.protocol === 'http:';
  const loopback = ehLoopback(url);
  const temCred = Boolean(user || pass);
  if (http && target === 'vps' && !loopback) {
    throw new ErroCli(`O alvo vps exige HTTPS (recebi ${url}). Basic-auth em HTTP vazaria a senha na rede.`, 2);
  }
  if (http && temCred && !loopback) {
    throw new ErroCli(`Com usuário ou senha, só aceito HTTP em loopback (127.0.0.1, localhost, ::1). Recebi ${url}.`, 2);
  }
  return true;
}

export function resolverDestino(args, cfg, env = process.env) {
  const target = args.target || env.JARVIS_TARGET || cfg.target || 'local';
  if (target !== 'local' && target !== 'vps') {
    throw new ErroCli(`Alvo inválido: "${target}". Use local ou vps.`, 2);
  }
  const bloco = cfg.targets?.[target] || {};
  const url = (args.url || env.JARVIS_URL || bloco.url || (target === 'vps' ? URL_VPS : URL_LOCAL)).replace(/\/$/, '');
  const user = args.user || env.JARVIS_USER || bloco.user || '';
  const pass = env.JARVIS_PASS || bloco.pass || '';
  const destino = { target, url, user, pass };
  validarUrlDestino(destino);
  return destino;
}

/* ------------------------------ HTTP ------------------------------- */

export class ErroCli extends Error {
  constructor(message, code = 1, extra = {}) {
    super(message);
    this.name = 'ErroCli';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function mensagemErroRede(e, url) {
  const cadeia = [];
  for (let x = e, n = 0; x && n < 6; x = x.cause, n++) cadeia.push(x);
  const code = cadeia.find(x => x.code)?.code || '';
  const nome = cadeia.find(x => x.name)?.name || '';
  const textos = cadeia.map(x => String(x.message || '')).join(' | ');
  if (nome === 'AbortError' || code === 'ABORT_ERR' || /timeout|aborted/i.test(textos)) {
    return `O JARVIS em ${url} não respondeu a tempo (timeout). Tente de novo, ou use --timeout.`;
  }
  if (/redirect/i.test(textos)) {
    return `O JARVIS em ${url} respondeu com um redirecionamento, e o CLI não segue redirects (para não encaminhar a senha do basic-auth).`;
  }
  const offline = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET']
    .find(c => c === code || textos.includes(c));
  if (offline || /fetch failed|bad port/i.test(textos)) {
    return `O JARVIS em ${url} parece offline (${offline || 'sem conexão'}). Confira se o serviço está no ar e se o --target/--url está certo.`;
  }
  if (e instanceof ErroCli) return e.message;
  return `Falha ao falar com ${url}: ${e.message}`;
}

export function interpretarHttp(status, corpo, url) {
  const erro = (corpo && (corpo.erro || corpo.message || corpo.error)) || '';
  if (status === 401) {
    return new ErroCli(
      `Acesso recusado (HTTP 401) em ${url}. Se for a VPS, confira usuário e senha com "jarvis config" ou JARVIS_USER/JARVIS_PASS. Não mostro a senha.`,
      1,
      { http: status },
    );
  }
  if (status === 403) {
    return new ErroCli(`Acesso proibido (HTTP 403) em ${url}${erro ? `: ${erro}` : '.'}`, 1, { http: status });
  }
  if (status === 404) {
    return new ErroCli(`Rota não encontrada (HTTP 404) em ${url}${erro ? `: ${erro}` : '.'}`, 1, { http: status });
  }
  return new ErroCli(`O JARVIS respondeu HTTP ${status} em ${url}${erro ? `: ${erro}` : '.'}`, 1, { http: status });
}

export const OPCOES_FETCH = { redirect: 'error' };

function cabecalhos({ user, pass, json = true, post = false }) {
  const h = { accept: 'application/json' };
  if (json) h['content-type'] = 'application/json';
  if (post) h['x-jarvis'] = '1';
  if (user || pass) h.authorization = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
  return h;
}

export async function requisitar(destino, { metodo = 'GET', caminho, corpo, timeout, signal } = {}) {
  const url = destino.url.replace(/\/$/, '') + caminho;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout ?? TIMEOUT_GET_MS);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const r = await fetch(url, {
      method: metodo,
      headers: cabecalhos({ user: destino.user, pass: destino.pass, post: metodo !== 'GET' }),
      body: corpo == null ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
      ...OPCOES_FETCH,
    });
    const tipo = r.headers.get('content-type') || '';
    if (tipo.includes('ndjson')) return r;
    const texto = await r.text();
    let dados = null;
    if (texto) {
      try { dados = JSON.parse(texto); } catch { dados = { bruto: texto }; }
    }
    if (!r.ok) throw interpretarHttp(r.status, dados, url);
    return { ok: true, status: r.status, dados, resposta: r };
  } catch (e) {
    if (e instanceof ErroCli) throw e;
    throw new ErroCli(mensagemErroRede(e, url), 1, { causa: e });
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function getJson(destino, caminho, timeout) {
  const r = await requisitar(destino, { caminho, timeout });
  return r.dados;
}

/* ------------------------------ chat NDJSON ------------------------ */

export async function lerNdjson(resposta, { onEvento = () => {}, signal } = {}) {
  const eventos = [];
  if (!resposta.body) return { eventos, texto: '', conversaId: null, fontes: [], erro: 'resposta sem corpo', modelo: null, rota: null };
  const reader = resposta.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let texto = '', conversaId = null, fontes = [], erro = null, modelo = null, rota = null;
  const tratar = ev => {
    eventos.push(ev);
    if (ev.tipo === 'inicio') {
      conversaId = ev.conversaId || conversaId;
      modelo = ev.modelo || modelo;
      if (Array.isArray(ev.fontes)) fontes = ev.fontes;
    } else if (ev.tipo === 'rota') {
      rota = ev.rota || rota;
      modelo = ev.modelo || modelo;
    } else if (ev.tipo === 'fontes' && Array.isArray(ev.fontes)) {
      fontes = ev.fontes;
    } else if (ev.tipo === 'delta' && ev.texto) {
      texto += ev.texto;
    } else if (ev.tipo === 'erro') {
      erro = ev.mensagem || ev.erro || erro;
    }
    onEvento(ev);
  };
  try {
    for (;;) {
      if (signal?.aborted) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linha) continue;
        try { tratar(JSON.parse(linha)); } catch { /* linha incompleta/lixo ignorada */ }
      }
    }
    const resto = buf.trim();
    if (resto) { try { tratar(JSON.parse(resto)); } catch { /* ignore */ } }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return { eventos, texto, conversaId, fontes, erro, modelo, rota };
}

export async function enviarChat(destino, { mensagem, conversaId, timeout, onEvento, signal } = {}) {
  const url = destino.url.replace(/\/$/, '') + '/api/chat';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout ?? TIMEOUT_CHAT_MS);
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: cabecalhos({ user: destino.user, pass: destino.pass, post: true }),
      body: JSON.stringify({ mensagem, ...(conversaId ? { conversaId } : {}) }),
      signal: ctrl.signal,
      ...OPCOES_FETCH,
    });
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok) {
      const texto = await r.text();
      let dados = null;
      try { dados = JSON.parse(texto); } catch { dados = { bruto: texto }; }
      throw interpretarHttp(r.status, dados, url);
    }
    if (!tipo.includes('ndjson') && !tipo.includes('json')) {
      // Ainda tentamos ler como NDJSON: é o formato real (application/x-ndjson).
    }
    return await lerNdjson(r, { onEvento, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof ErroCli) throw e;
    throw new ErroCli(mensagemErroRede(e, url), 1, { causa: e });
  } finally {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ----------------------- confirmação (texto) ----------------------- */

// A API HTTP atual NÃO tem rota de confirmação. O "sim" de nível 2 vive no Telegram
// (src/confirmacoes.mjs + src/telegram.mjs). O CLI só detecta o pedido no texto
// (ou um eventual evento futuro tipo:"confirmacao") e, no terminal interativo,
// pergunta se deve mandar "sim" ou "não" como próxima mensagem da mesma conversa.
export function detectaPedidoConfirmacao(resultado) {
  if (!resultado) return false;
  if (resultado.eventos?.some(e => e && (e.tipo === 'confirmacao' || e.pendente || e.confirmacao))) return true;
  const t = String(resultado.texto || '');
  return /expira em 10 min|um ["“]?sim["”]? vale|precisa(?:r)? de ["“]?sim["”]?|confirmação pendente|botão de confirmação/i.test(t);
}

/* ------------------------------ formato ---------------------------- */

export function formatarSaude(s) {
  if (!s || typeof s !== 'object') return String(s);
  const linhas = [];
  linhas.push(`JARVIS ${s.versao || '?'} · ${s.ok ? 'no ar' : 'com problema'}`);
  linhas.push(`Modelo principal: ${s.modelo || '?'}${s.nuvemLocal ? ' (Ollama local, sem chave)' : ''}`);
  linhas.push(`Modelo local (classificador/trivial): ${s.local || 'desligado'}`);
  linhas.push(`Reserva 9Router: ${s.reserva ? 'ligada' : 'desligada'}`);
  if (s.hermes) linhas.push(`Hermes: ${s.hermes.ok ? `ok${s.hermes.versao ? ' (' + s.hermes.versao + ')' : ''}` : (s.hermes.motivo || 'indisponível')}`);
  else linhas.push('Hermes: desligado ou ainda não medido');
  if (s.nvidia) linhas.push(`nvidia-app: ${s.nvidia.ok ? 'leitura ok' : (s.nvidia.motivo || 'indisponível')}`);
  else linhas.push('nvidia-app: desligado ou ainda não medido');
  if (s.voicebox) linhas.push(`Voicebox: ${s.voicebox.ok ? 'ok' : (s.voicebox.motivo || 'indisponível')}`);
  const idx = s.indexado
    ? new Date(s.indexado).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' })
    : '—';
  linhas.push(`Vault: ${s.notas ?? '?'} notas, ${s.trechos ?? '?'} trechos (indexado ${idx}, Acre)${s.ignorados != null ? `, ${s.ignorados} ignorados` : ''}`);
  return linhas.join('\n');
}

export function formatarCusto(c) {
  if (!c) return '';
  const blocos = [];
  if (c.hoje) blocos.push(textoResumoLocal(c.hoje));
  if (c.semana) blocos.push(textoResumoLocal(c.semana));
  if (!blocos.length) return JSON.stringify(c, null, 2);
  return blocos.join('\n\n');
}

function textoResumoLocal(s) {
  if (!s || !s.total) return `Uso (${s?.dias === 1 ? 'hoje' : `últimos ${s?.dias ?? '?'} dias`}): nenhuma resposta registrada ainda.`;
  const nomes = {
    regras: 'Regras (sem IA)',
    local: 'Local (Ollama VPS)',
    nuvem: 'Nuvem (Ollama Cloud)',
    'plano-b-regras': 'Plano B por regras',
    'reserva-9router': 'Reserva 9Router (PC)',
  };
  const linhas = Object.entries(s.rotas || {}).map(([k, r]) => {
    const media = r.chamadas ? (Math.round(r.ms / r.chamadas / 100) / 10) : 0;
    return `• ${nomes[k] || k}: ${r.chamadas} resp., ${r.tokens} tokens, média ${media}s${r.erros ? `, ${r.erros} erro(s)` : ''}${r.planoB ? `, ${r.planoB} plano B` : ''}`;
  });
  return `Uso (${s.dias === 1 ? 'hoje' : `últimos ${s.dias} dias`}, Acre): ${s.total} respostas\n${linhas.join('\n')}`;
}

export function formatarTextoApi(dados) {
  if (dados == null) return '';
  if (typeof dados.texto === 'string') return dados.texto;
  if (typeof dados === 'string') return dados;
  return JSON.stringify(dados, null, 2);
}

/* ------------------------------ comandos --------------------------- */

async function cmdHealth(destino, args, out) {
  const dados = await getJson(destino, '/api/saude', args.timeout ?? TIMEOUT_GET_MS);
  if (args.json) out.escreverJson(dados);
  else out.escrever(formatarSaude(dados));
  return dados?.ok ? 0 : 1;
}

async function cmdStatus(destino, args, out) {
  const timeout = args.timeout ?? TIMEOUT_GET_MS;
  const [saude, custo] = await Promise.all([
    getJson(destino, '/api/saude', timeout),
    getJson(destino, '/api/custo', timeout).catch(e => ({ erro: e.message })),
  ]);
  const pacote = { saude, custo };
  if (args.json) out.escreverJson(pacote);
  else {
    out.escrever(formatarSaude(saude));
    if (custo && !custo.erro) {
      out.escrever('');
      out.escrever(formatarCusto(custo));
    } else if (custo?.erro) {
      out.aviso('Não consegui ler /api/custo: ' + custo.erro);
    }
  }
  return saude?.ok ? 0 : 1;
}

async function cmdGet(destino, args, out, caminho, { opcional = false, rotulo = caminho } = {}) {
  try {
    const dados = await getJson(destino, caminho, args.timeout ?? TIMEOUT_GET_MS);
    if (args.json) out.escreverJson(dados);
    else out.escrever(formatarTextoApi(dados));
    return 0;
  } catch (e) {
    if (opcional && e.http === 404) {
      const msg = `${rotulo} não existe nesta instância do JARVIS (HTTP 404). ` +
        'Essa rota aparece na VPS / branch Voicebox e pode não estar no servidor mais antigo.';
      if (args.json) out.escreverJson({ ok: false, ausente: true, rota: caminho, erro: msg });
      else out.aviso(msg);
      return 0;
    }
    throw e;
  }
}

async function cmdAsk(destino, args, out, { mensagem, conversaId, interativo = false } = {}) {
  const texto = (mensagem ?? args.texto ?? '').trim();
  if (!texto) throw new ErroCli('Mensagem vazia. Uso: jarvis "sua pergunta"  ou  echo texto | jarvis', 2);
  if (texto.length > 8000) throw new ErroCli('Mensagem longa demais (máx. 8000 caracteres, limite da API).', 2);
  if (!args.json && interativo) out.meta('consultando…');
  let imprimindo = false;
  const resultado = await enviarChat(destino, {
    mensagem: texto,
    conversaId: conversaId || args.conversa,
    timeout: args.timeout ?? TIMEOUT_CHAT_MS,
    onEvento: ev => {
      if (args.json) return;
      if (ev.tipo === 'delta' && ev.texto) {
        imprimindo = true;
        out.stream(ev.texto);
      }
    },
  });
  if (args.json) {
    out.escreverJson({
      conversaId: resultado.conversaId,
      texto: resultado.texto,
      fontes: resultado.fontes,
      modelo: resultado.modelo,
      rota: resultado.rota,
      erro: resultado.erro,
      eventos: resultado.eventos,
    });
    return resultado.erro ? 1 : 0;
  }
  if (!imprimindo) {
    if (resultado.texto) out.escrever(resultado.texto);
  } else {
    out.stream('\n');
  }
  if (resultado.fontes?.length) out.meta('fontes: ' + resultado.fontes.join(' · '));
  if (resultado.erro) out.aviso('erro: ' + resultado.erro);
  return resultado.erro ? 1 : 0;
}

async function cmdChat(destino, args, out, io) {
  if (args.json) throw new ErroCli('O modo chat interativo não combina com --json. Use "jarvis ask --json".', 2);
  let conversaId = args.conversa || null;
  const cor = out.cor;
  const stdin = io?.stdin || stdinFd;
  const stdout = io?.stdout || stdoutFd;
  out.escrever(cor.bold(`JARVIS ${VERSAO}`) + cor.gray(` · ${destino.target} · ${destino.url}`));
  out.escrever(cor.dim('Digite a pergunta ou um comando com /  ·  /nova  /id  /sair  ·  Ctrl+C para encerrar'));
  const rl = io?.criarRl?.() || createInterface({ input: stdin, output: stdout, terminal: Boolean(stdout.isTTY) });
  const perguntarSimNao = async (enunciado) => {
    const r = (await rl.question(cor.yellow(enunciado) + ' ')).trim().toLowerCase();
    return r === 's' || r === 'sim' || r === 'y' || r === 'yes';
  };
  try {
    for (;;) {
      let linha;
      try {
        linha = await rl.question(cor.cyan('você> '));
      } catch {
        out.escrever('');
        break;
      }
      const texto = String(linha || '').trim();
      if (!texto) continue;
      const baixo = texto.toLowerCase();
      if (baixo === '/sair' || baixo === '/exit' || baixo === '/quit') break;
      if (baixo === '/nova') {
        conversaId = null;
        out.meta('Conversa nova. A próxima mensagem abre um id novo.');
        continue;
      }
      if (baixo === '/id') {
        out.meta(conversaId ? `conversa ${conversaId}` : 'ainda não há conversa (mande uma mensagem).');
        continue;
      }
      out.stream(cor.green('jarvis> '));
      const resultado = await enviarChat(destino, {
        mensagem: texto,
        conversaId,
        timeout: args.timeout ?? TIMEOUT_CHAT_MS,
        onEvento: ev => {
          if (ev.tipo === 'delta' && ev.texto) out.stream(ev.texto);
        },
      });
      if (resultado.conversaId) conversaId = resultado.conversaId;
      if (!resultado.texto) out.stream('');
      out.stream('\n');
      if (resultado.fontes?.length) out.meta('fontes: ' + resultado.fontes.join(' · '));
      if (resultado.erro) out.aviso('erro: ' + resultado.erro);
      if (detectaPedidoConfirmacao(resultado) && stdin.isTTY) {
        out.aviso('O texto parece pedir um "sim". No servidor de hoje, a confirmação de nível 2 só executa no Telegram; aqui isso vira a próxima mensagem desta conversa.');
        const sim = await perguntarSimNao('Enviar "sim"? [s/N]');
        const msg = sim ? 'sim' : 'não';
        if (!sim) {
          const cancelar = await perguntarSimNao('Enviar "não" para cancelar? [s/N]');
          if (!cancelar) continue;
        }
        out.stream(cor.green('jarvis> '));
        const r2 = await enviarChat(destino, {
          mensagem: msg,
          conversaId,
          timeout: args.timeout ?? TIMEOUT_CHAT_MS,
          onEvento: ev => { if (ev.tipo === 'delta' && ev.texto) out.stream(ev.texto); },
        });
        if (r2.conversaId) conversaId = r2.conversaId;
        out.stream('\n');
      }
    }
  } finally {
    rl.close();
  }
  return 0;
}

async function cmdReindexar(destino, args, out, io) {
  const stdin = io?.stdin || stdinFd;
  const stdout = io?.stdout || stdoutFd;
  if (stdin.isTTY && !args.json) {
    const rl = io?.criarRl?.() || createInterface({ input: stdin, output: stdout, terminal: Boolean(stdout.isTTY) });
    try {
      const r = (await rl.question('Isso só reconstrói o índice do vault (POST /api/reindexar). Continuar? [s/N] ')).trim().toLowerCase();
      if (r !== 's' && r !== 'sim') {
        out.escrever('Cancelado. Nada foi feito.');
        return 0;
      }
    } finally { rl.close(); }
  }
  const r = await requisitar(destino, { metodo: 'POST', caminho: '/api/reindexar', corpo: {}, timeout: args.timeout ?? TIMEOUT_GET_MS });
  if (args.json) out.escreverJson(r.dados);
  else out.escrever(formatarTextoApi(r.dados));
  return 0;
}

async function cmdConfig(args, out, io, env = process.env) {
  const arquivo = caminhoConfig(env);
  const atual = await carregarConfig(arquivo);
  if (args.configShow) {
    if (args.json) out.escreverJson({ arquivo, config: redigirConfig(atual) });
    else {
      out.escrever(`arquivo: ${arquivo}${existsSync(arquivo) ? '' : ' (ainda não existe; mostrando o padrão)'}`);
      out.escrever(JSON.stringify(redigirConfig(atual), null, 2));
    }
    return 0;
  }
  const interativo = Boolean((io?.stdin || stdinFd).isTTY);
  const alvo = args.target || atual.target || 'local';
  const bloco = atual.targets[alvo] || {};
  let url = args.url || bloco.url || (alvo === 'vps' ? URL_VPS : URL_LOCAL);
  let user = args.user || bloco.user || (alvo === 'vps' ? 'jean' : '');
  let pass = env.JARVIS_PASS || bloco.pass || '';

  if (interativo && !args.json) {
    const rl = io?.criarRl?.() || createInterface({ input: io?.stdin || stdinFd, output: io?.stdout || stdoutFd });
    try {
      const t = (await rl.question(`Alvo padrão [local/vps] (${alvo}): `)).trim().toLowerCase() || alvo;
      if (t !== 'local' && t !== 'vps') throw new ErroCli('Alvo deve ser local ou vps.', 2);
      atual.target = t;
      const loc = (await rl.question(`URL local (${atual.targets.local.url}): `)).trim();
      if (loc) atual.targets.local.url = loc.replace(/\/$/, '');
      const vps = (await rl.question(`URL da VPS (${atual.targets.vps.url}): `)).trim();
      if (vps) atual.targets.vps.url = vps.replace(/\/$/, '');
      const u = (await rl.question(`Usuário da VPS (${atual.targets.vps.user || 'jean'}): `)).trim();
      if (u) atual.targets.vps.user = u;
      out.escrever('Senha da VPS (não aparece; deixe em branco para não gravar; fica só neste arquivo):');
      const senha = await lerSenhaEscondida(io?.stdin || stdinFd, io?.stdout || stdoutFd);
      if (senha) atual.targets.vps.pass = senha;
    } finally { rl.close(); }
  } else {
    atual.target = alvo;
    if (args.url) atual.targets[alvo].url = url.replace(/\/$/, '');
    if (args.user) atual.targets[alvo].user = user;
    if (pass && alvo === 'vps') atual.targets.vps.pass = pass;
  }

  const salvo = await salvarConfig(atual, arquivo);
  if (args.json) out.escreverJson({ arquivo: salvo, config: redigirConfig(atual) });
  else out.escrever(`Config gravada em ${salvo} (permissão restrita). A senha não é exibida.`);
  return 0;
}

async function lerSenhaEscondida(stdin, stdout) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      // Sem TTY não lemos senha da entrada (poderia vazar em log). Use JARVIS_PASS.
      resolve('');
      return;
    }
    const wasRaw = stdin.isRaw;
    let s = '';
    stdout.write('> ');
    const onData = buf => {
      const str = buf.toString('utf8');
      for (const ch of str) {
        if (ch === '\n' || ch === '\r') {
          cleanup();
          stdout.write('\n');
          resolve(s);
          return;
        }
        if (ch === '\u0003') { cleanup(); reject(new ErroCli('Cancelado.', 130)); return; }
        if (ch === '\u007f' || ch === '\b') { s = s.slice(0, -1); continue; }
        if (ch === '\u0015') { s = ''; continue; } // Ctrl+U
        if (ch < ' ') continue;
        s += ch;
      }
    };
    const cleanup = () => {
      stdin.off('data', onData);
      if (typeof stdin.setRawMode === 'function') stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

/* ------------------------------ I/O + main ------------------------- */

export function criarSaida({ json = false, noColor = false, stdout = stdoutFd, stderr = stderrFd } = {}) {
  const cor = paleta(querCor({ json, noColor, tty: stdout.isTTY }));
  return {
    cor,
    escrever(s) { stdout.write(String(s) + (String(s).endsWith('\n') ? '' : '\n')); },
    stream(s) { stdout.write(String(s)); },
    escreverJson(obj) { stdout.write(JSON.stringify(obj, null, 2) + '\n'); },
    meta(s) { stderr.write(cor.gray(String(s)) + '\n'); },
    aviso(s) { stderr.write(cor.yellow(String(s)) + '\n'); },
    erro(s) { stderr.write(cor.red(String(s)) + '\n'); },
  };
}

export async function lerStdinSePipe(stdin = stdinFd) {
  if (stdin.isTTY) return '';
  const pedacos = [];
  for await (const c of stdin) pedacos.push(c);
  return Buffer.concat(pedacos.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c))).toString('utf8').trim();
}

export async function executar(argv, { env = process.env, stdin = stdinFd, stdout = stdoutFd, stderr = stderrFd, io } = {}) {
  let args;
  try { args = parseArgs(argv); }
  catch (e) {
    const out = criarSaida({ stdout, stderr });
    out.erro(e.message);
    return e.code || 2;
  }
  const out = criarSaida({ json: args.json, noColor: args.noColor, stdout, stderr });
  if (args.help || args.comando === 'help' || args.comando === 'ajuda') {
    out.escrever(AJUDA.trim());
    return 0;
  }
  if (args.version || args.comando === 'version' || args.comando === 'versao') {
    out.escrever(args.json ? JSON.stringify({ versao: VERSAO, cli: 'jarvis' }) : `jarvis ${VERSAO}`);
    return 0;
  }

  try {
    const ioEfetivo = { stdin, stdout, stderr, ...io };
    const avisoTls = avisoTlsInseguro(env);
    if (avisoTls) out.aviso(avisoTls);

    if (args.timeout == null && env.JARVIS_TIMEOUT_MS) {
      args.timeout = validarTimeout(env.JARVIS_TIMEOUT_MS, 'JARVIS_TIMEOUT_MS');
    }

    if (args.comando === 'config') return await cmdConfig(args, out, ioEfetivo, env);

    if (!args.comando) {
      const piped = await lerStdinSePipe(stdin);
      if (piped) {
        args.comando = 'ask';
        args.texto = piped;
      } else {
        out.escrever(AJUDA.trim());
        return 0;
      }
    }

    if (args.comando === 'ask' && !args.texto) {
      const piped = await lerStdinSePipe(stdin);
      if (piped) args.texto = piped;
    }

    const cfg = await carregarConfig(caminhoConfig(env));
    const destino = resolverDestino(args, cfg, env);

    switch (args.comando) {
      case 'health':
      case 'saude':
        return await cmdHealth(destino, args, out);
      case 'status':
        return await cmdStatus(destino, args, out);
      case 'hermes':
        return await cmdGet(destino, args, out, '/api/hermes');
      case 'nvidia':
        return await cmdGet(destino, args, out, '/api/nvidia');
      case 'mestre':
        return await cmdGet(destino, args, out, '/api/mestre', { opcional: true, rotulo: 'GET /api/mestre' });
      case 'voz':
        return await cmdGet(destino, args, out, '/api/voz', { opcional: true, rotulo: 'GET /api/voz' });
      case 'skills':
        return await cmdGet(destino, args, out, '/api/skills');
      case 'custo':
        return await cmdGet(destino, args, out, '/api/custo');
      case 'rotinas':
        return await cmdGet(destino, args, out, '/api/rotinas');
      case 'conversas':
        return await cmdGet(destino, args, out, '/api/conversas');
      case 'reindexar':
        return await cmdReindexar(destino, args, out, ioEfetivo);
      case 'ask':
        return await cmdAsk(destino, args, out);
      case 'chat':
        return await cmdChat(destino, args, out, ioEfetivo);
      default:
        throw new ErroCli(`Comando desconhecido: ${args.comando}`, 2);
    }
  } catch (e) {
    out.erro(e instanceof ErroCli ? e.message : String(e && e.message || e));
    return e instanceof ErroCli ? (e.code || 1) : 1;
  }
}

export function ehEntradaPrincipal(metaUrl = import.meta.url, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    const self = path.resolve(fileURLToPath(metaUrl));
    const invoc = path.resolve(argv1);
    return self === invoc || path.normalize(self).toLowerCase() === path.normalize(invoc).toLowerCase();
  } catch {
    return false;
  }
}

if (ehEntradaPrincipal()) {
  executar(process.argv.slice(2)).then(code => {
    process.exitCode = code;
  }).catch(e => {
    stderrFd.write((e && e.message ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}
