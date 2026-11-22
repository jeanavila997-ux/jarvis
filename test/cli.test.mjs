// Testes do CLI do JARVIS: servidor HTTP de mentira, sem rede de verdade.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, caminhoConfig, carregarConfig, salvarConfig, redigirConfig,
  resolverDestino, detectaPedidoConfirmacao, formatarSaude, mensagemErroRede,
  executar, VERSAO, URL_LOCAL, URL_VPS, querCor,
} from '../cli/jarvis.mjs';

const CLI = fileURLToPath(new URL('../cli/jarvis.mjs', import.meta.url));

function iniciarMock({ authUser, authPass, semMestre = false, atrasarMs = 0 } = {}) {
  const estado = { posts: [], conversa: null, reindex: 0 };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (authUser || authPass) {
      const esperada = 'Basic ' + Buffer.from(`${authUser}:${authPass}`, 'utf8').toString('base64');
      if (req.headers.authorization !== esperada) {
        res.writeHead(401, { 'content-type': 'application/json', 'www-authenticate': 'Basic realm="JARVIS"' });
        res.end(JSON.stringify({ erro: 'nao autorizado' }));
        return;
      }
    }

    if (atrasarMs && p === '/api/saude') {
      await new Promise(r => setTimeout(r, atrasarMs));
    }

    const json = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };

    if (p === '/api/saude' && req.method === 'GET') {
      return json(200, {
        ok: true, versao: '0.2.0', modelo: 'glm-5.3-flash', local: null, nuvemLocal: false,
        hermes: { ok: true, versao: '0.23.1' }, nvidia: { ok: false, motivo: 'ainda-nao-medido' },
        reserva: false, notas: 12, trechos: 80, ignorados: 1, indexado: '2026-11-22T03:00:00.000Z',
      });
    }
    if (p === '/api/custo' && req.method === 'GET') {
      return json(200, {
        hoje: { dias: 1, total: 2, rotas: { regras: { chamadas: 2, tokens: 0, ms: 20, erros: 0, planoB: 0 } }, porDia: {} },
        semana: { dias: 7, total: 2, rotas: { regras: { chamadas: 2, tokens: 0, ms: 20, erros: 0, planoB: 0 } }, porDia: {} },
      });
    }
    if (p === '/api/hermes' && req.method === 'GET') return json(200, { texto: 'Hermes: no ar (0.23.1)', snap: { ok: true } });
    if (p === '/api/nvidia' && req.method === 'GET') return json(200, { texto: 'nvidia-app: desligado', snap: null });
    if (p === '/api/skills' && req.method === 'GET') return json(200, { instaladas: ['demo'] });
    if (p === '/api/rotinas' && req.method === 'GET') return json(200, { ativo: false });
    if (p === '/api/conversas' && req.method === 'GET') return json(200, [{ id: '11111111-1111-1111-1111-111111111111', titulo: 'oi', atualizado: '2026-11-22', n: 2 }]);
    if (p === '/api/mestre' && req.method === 'GET') {
      if (semMestre) return json(404, { erro: 'não encontrado' });
      return json(200, { texto: 'Mestre: desligado', ativo: false });
    }
    if (p === '/api/voz' && req.method === 'GET') {
      if (semMestre) return json(404, { erro: 'não encontrado' });
      return json(200, { texto: 'Voicebox: ok', ativo: true });
    }
    if (p === '/api/reindexar' && req.method === 'POST') {
      if (req.headers['x-jarvis'] !== '1') return json(403, { erro: 'cabeçalho X-Jarvis ausente' });
      estado.reindex++;
      return json(200, { notas: 12, trechos: 80, ignorados: [] });
    }
    if (p === '/api/chat' && req.method === 'POST') {
      if (req.headers['x-jarvis'] !== '1') return json(403, { erro: 'cabeçalho X-Jarvis ausente' });
      let s = '';
      for await (const ch of req) s += ch;
      let body = {};
      try { body = s ? JSON.parse(s) : {}; } catch { return json(400, { erro: 'json inválido' }); }
      const texto = String(body.mensagem || '').trim();
      if (!texto) return json(400, { erro: 'mensagem vazia' });
      const conversaId = body.conversaId && /^[a-f0-9-]{36}$/.test(body.conversaId)
        ? body.conversaId
        : 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      estado.conversa = conversaId;
      estado.posts.push(texto);
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
      const ev = o => res.write(JSON.stringify(o) + '\n');
      ev({ tipo: 'inicio', conversaId, modelo: 'glm-5.3-flash', fontes: [] });
      ev({ tipo: 'rota', rota: 'regras', modelo: 'regras' });
      let resposta = `eco: ${texto}`;
      if (/^\/?status/.test(texto)) resposta = 'JARVIS no ar há 1h00min';
      if (texto === 'pede-sim') resposta = 'Ação de nível 2:\n• Teste\nExpira em 10 minutos. Um "sim" vale para uma ação só.';
      ev({ tipo: 'delta', texto: resposta });
      ev({ tipo: 'fontes', fontes: ['nota-a'] });
      ev({ tipo: 'fim' });
      res.end();
      return;
    }
    json(404, { erro: 'não encontrado' });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}`, estado, fechar: () => new Promise((res, rej) => server.close(e => e ? rej(e) : res())) });
    });
  });
}

async function rodar(args, { env = {}, input, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out = [], err = [];
    filho.stdout.on('data', d => out.push(d));
    filho.stderr.on('data', d => err.push(d));
    if (input != null) { filho.stdin.write(input); filho.stdin.end(); }
    else filho.stdin.end();
    const t = setTimeout(() => { filho.kill('SIGKILL'); reject(new Error('timeout do processo CLI')); }, timeout);
    filho.on('close', code => {
      clearTimeout(t);
      resolve({
        code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });
    filho.on('error', reject);
  });
}

async function comConfigTemp(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'jarvis-cli-'));
  const arquivo = path.join(dir, 'config.json');
  try { return await fn(arquivo, dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

describe('parseArgs', () => {
  it('trata "pergunta" solta como ask', () => {
    const a = parseArgs(['olá', 'mundo']);
    assert.equal(a.comando, 'ask');
    assert.equal(a.texto, 'olá mundo');
  });
  it('aceita flags antes e depois do comando', () => {
    const a = parseArgs(['--target', 'vps', 'status', '--json']);
    assert.equal(a.comando, 'status');
    assert.equal(a.target, 'vps');
    assert.equal(a.json, true);
  });
  it('recusa --target inválido', () => {
    assert.throws(() => parseArgs(['--target', 'nuvem']), /local.+vps/);
  });
  it('reconhece config show', () => {
    const a = parseArgs(['config', 'show']);
    assert.equal(a.comando, 'config');
    assert.equal(a.configShow, true);
  });
});

describe('config', () => {
  it('caminho no Linux usa XDG ou ~/.config/jarvis', () => {
    const p = caminhoConfig({ XDG_CONFIG_HOME: '/tmp/xdg-test', HOME: '/home/jean' });
    // em Linux deste teste, platform não é win32
    if (process.platform !== 'win32') {
      assert.equal(p, path.resolve('/tmp/xdg-test/jarvis/config.json'));
    }
  });
  it('JARVIS_CONFIG manda no caminho', () => {
    assert.equal(caminhoConfig({ JARVIS_CONFIG: '/tmp/meu/j.json' }), path.resolve('/tmp/meu/j.json'));
  });
  it('grava com permissão restrita e show redige a senha', async () => {
    await comConfigTemp(async (arquivo) => {
      const cfg = {
        target: 'vps',
        targets: {
          local: { url: URL_LOCAL },
          vps: { url: URL_VPS, user: 'jean', pass: 'segredo-nao-vazar' },
        },
      };
      await salvarConfig(cfg, arquivo);
      const st = await stat(arquivo);
      if (process.platform !== 'win32') {
        assert.equal(st.mode & 0o777, 0o600);
      }
      const lido = await carregarConfig(arquivo);
      assert.equal(lido.targets.vps.pass, 'segredo-nao-vazar');
      const visivel = JSON.stringify(redigirConfig(lido));
      assert.equal(visivel.includes('segredo-nao-vazar'), false);
      assert.equal(visivel.includes('***'), true);
    });
  });
  it('resolverDestino: flags > env > arquivo > padrão', () => {
    const cfg = { target: 'local', targets: { local: { url: 'http://a' }, vps: { url: 'https://b', user: 'arquivo', pass: 'p1' } } };
    const d = resolverDestino({ target: 'vps', url: null, user: null, pass: null }, cfg, { JARVIS_USER: 'envuser' });
    assert.equal(d.target, 'vps');
    assert.equal(d.url, 'https://b');
    assert.equal(d.user, 'envuser');
    assert.equal(d.pass, 'p1');
  });
});

describe('formato e detecção', () => {
  it('formatarSaude usa os campos reais de /api/saude', () => {
    const t = formatarSaude({ ok: true, versao: '0.2.0', modelo: 'glm-5.3-flash', local: null, reserva: false, notas: 3, trechos: 9, indexado: '2026-11-22T08:00:00.000Z' });
    assert.match(t, /JARVIS 0\.2\.0 · no ar/);
    assert.match(t, /glm-5\.3-flash/);
    assert.match(t, /Vault: 3 notas, 9 trechos/);
  });
  it('detecta pedido de confirmação no texto, não inventa rota', () => {
    assert.equal(detectaPedidoConfirmacao({ texto: 'Expira em 10 minutos. Um "sim" vale para uma ação só.' }), true);
    assert.equal(detectaPedidoConfirmacao({ texto: 'Tudo certo, sem pendência.' }), false);
    assert.equal(detectaPedidoConfirmacao({ eventos: [{ tipo: 'confirmacao', id: 'abc' }], texto: '' }), true);
  });
  it('mensagem de offline e timeout são claras', () => {
    const off = mensagemErroRede({ code: 'ECONNREFUSED' }, 'http://127.0.0.1:3200');
    assert.match(off, /offline/);
    assert.match(off, /127\.0\.0\.1:3200/);
    const to = mensagemErroRede({ name: 'AbortError', message: 'timeout' }, 'https://exemplo');
    assert.match(to, /não respondeu a tempo/);
  });
  it('querCor desliga com --json, --no-color e NO_COLOR', () => {
    assert.equal(querCor({ json: true, tty: true }), false);
    assert.equal(querCor({ noColor: true, tty: true }), false);
  });
});

describe('HTTP de mentira', () => {
  let mock;
  before(async () => { mock = await iniciarMock(); });
  after(async () => { await mock.fechar(); });

  it('health fala com GET /api/saude', async () => {
    const r = await rodar(['health', '--url', mock.url, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.versao, '0.2.0');
  });

  it('status junta /api/saude e /api/custo', async () => {
    const r = await rodar(['status', '--url', mock.url, '--json']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.saude.ok, true);
    assert.equal(j.custo.hoje.total, 2);
  });

  it('ask envia POST /api/chat com X-Jarvis e lê NDJSON', async () => {
    const r = await rodar(['ask', 'oi do cli', '--url', mock.url]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /eco: oi do cli/);
    assert.equal(mock.estado.posts.at(-1), 'oi do cli');
    assert.equal(mock.estado.conversa, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('--json no ask devolve conversaId, texto, fontes e eventos', async () => {
    const r = await rodar(['--json', 'ask', '/status', '--url', mock.url]);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.conversaId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    assert.match(j.texto, /JARVIS no ar/);
    assert.deepEqual(j.fontes, ['nota-a']);
    assert.equal(j.eventos[0].tipo, 'inicio');
    assert.equal(j.rota, 'regras');
  });

  it('stdin vira pergunta (echo texto | jarvis)', async () => {
    const r = await rodar(['--url', mock.url], { input: 'pelo cano\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /eco: pelo cano/);
  });

  it('health em porta fechada explica que está offline', async () => {
    const r = await rodar(['health', '--url', 'http://127.0.0.1:59999']);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /offline|ECONNREFUSED/);
  });

  it('--help é em pt-BR e cita as rotas reais', async () => {
    const r = await rodar(['--help']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /GET \/api\/saude/);
    assert.match(r.stdout, /POST \/api\/chat/);
    assert.match(r.stdout, /jarvis chat/);
    assert.match(r.stdout, /--target local\|vps/);
    assert.match(r.stdout, /echo texto \| jarvis/);
    assert.doesNotMatch(r.stdout, /\/api\/health\b/); // rota inventada
  });

  it('--version imprime a versão', async () => {
    const r = await rodar(['-V']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, new RegExp(VERSAO));
  });

  it('rotas opcionais 404 não quebram (mestre/voz)', async () => {
    const m2 = await iniciarMock({ semMestre: true });
    try {
      const r = await rodar(['mestre', '--url', m2.url]);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /não existe nesta instância/);
    } finally { await m2.fechar(); }
  });

  it('401 explica basic-auth sem vazar senha', async () => {
    const m2 = await iniciarMock({ authUser: 'jean', authPass: 'segredo-teste-xyz' });
    try {
      const r = await rodar(['health', '--url', m2.url, '--user', 'jean'], {
        env: { JARVIS_PASS: 'senha-errada' },
      });
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /HTTP 401/);
      assert.doesNotMatch(r.stdout + r.stderr, /segredo-teste-xyz/);
      assert.doesNotMatch(r.stdout + r.stderr, /senha-errada/);
      const ok = await rodar(['health', '--url', m2.url, '--user', 'jean', '--json'], {
        env: { JARVIS_PASS: 'segredo-teste-xyz' },
      });
      assert.equal(ok.code, 0, ok.stderr);
      assert.equal(JSON.parse(ok.stdout).ok, true);
    } finally { await m2.fechar(); }
  });

  it('timeout vira mensagem clara', async () => {
    const m2 = await iniciarMock({ atrasarMs: 400 });
    try {
      const r = await rodar(['health', '--url', m2.url, '--timeout', '50'], { timeout: 5000 });
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, /não respondeu a tempo|timeout/i);
    } finally { await m2.fechar(); }
  });

  it('config show não imprime senha', async () => {
    await comConfigTemp(async (arquivo) => {
      await salvarConfig({
        target: 'vps',
        targets: { local: { url: URL_LOCAL }, vps: { url: URL_VPS, user: 'jean', pass: 'nao-aparecer-abc' } },
      }, arquivo);
      const r = await rodar(['config', 'show'], { env: { JARVIS_CONFIG: arquivo } });
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stdout + r.stderr, /nao-aparecer-abc/);
      assert.match(r.stdout, /\*\*\*/);
    });
  });

  it('executar() via import: hermes e skills', async () => {
    const saida = { out: '', err: '' };
    const stdout = { write(s) { saida.out += s; return true; }, isTTY: false };
    const stderr = { write(s) { saida.err += s; return true; }, isTTY: false };
    const code = await executar(['--json', 'skills', '--url', mock.url], {
      env: { ...process.env, JARVIS_CONFIG: path.join(tmpdir(), 'nao-existe-jarvis-cli-xyz.json') },
      stdout, stderr, stdin: { isTTY: true, async *[Symbol.asyncIterator]() {} },
    });
    assert.equal(code, 0, saida.err);
    assert.deepEqual(JSON.parse(saida.out).instaladas, ['demo']);
  });
});
