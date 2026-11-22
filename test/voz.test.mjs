import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { criarClienteVoz, interpretarPedidoVoz, textoVozStatus } from '../src/voz.mjs';

const WAV = Buffer.from(
  'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00',
  'binary',
);
const OGG = Buffer.from('OggS-teste-opus');

function fakeProc(stdoutBuf, code = 0, delayMs = 0) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const p = new EventEmitter();
  p.stdout = stdout; p.stderr = stderr; p.stdin = stdin;
  stdin.on('finish', () => {
    setTimeout(() => {
      stdout.end(stdoutBuf || Buffer.alloc(0));
      stderr.end();
      p.emit('close', code);
    }, delayMs);
  });
  stdin.resume();
  return p;
}

function servidor({ ok = true, atrasarMs = 0, streamOk = true } = {}) {
  let gerarCount = 0, perfis = [];
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ok ? { status: 'ok' } : { status: 'down' }));
    }
    if (url === '/profiles' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(perfis));
    }
    if (url === '/profiles' && req.method === 'POST') {
      perfis = [{ id: 'perfil-dora', name: 'JARVIS Dora PT', preset_voice_id: 'pf_dora' }];
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(perfis[0]));
    }
    if (url === '/generate/stream' && req.method === 'POST') {
      if (!streamOk) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'kokoro model is not downloaded yet. Use /generate to trigger a download.' }));
      }
      gerarCount += 1;
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'audio/wav' });
        res.end(WAV);
      }, atrasarMs);
      return;
    }
    if (url === '/generate' && req.method === 'POST') {
      gerarCount += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'gen-1', status: 'generating' }));
    }
    if (url === '/history/gen-1' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ id: 'gen-1', status: 'completed' }));
    }
    if (url === '/audio/gen-1' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(WAV);
    }
    res.writeHead(404); res.end();
  });
  server._gerarCount = () => gerarCount;
  return server;
}

function listen(server) {
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address())));
}

test('interpretarPedidoVoz: status, ligar, desligar, falar; ignora texto comum', () => {
  assert.equal(interpretarPedidoVoz('bom dia'), null);
  assert.equal(interpretarPedidoVoz('status do hermes'), null);
  assert.equal(interpretarPedidoVoz('/voz').acao, 'status');
  assert.equal(interpretarPedidoVoz('/voz status').acao, 'status');
  assert.equal(interpretarPedidoVoz('responder em áudio').acao, 'ligar');
  assert.equal(interpretarPedidoVoz('modo voz').acao, 'ligar');
  assert.equal(interpretarPedidoVoz('só texto').acao, 'desligar');
  const f = interpretarPedidoVoz('/voz Olá, Jean. Este é um teste.');
  assert.equal(f.acao, 'falar');
  assert.match(f.texto, /Olá, Jean/);
  assert.equal(interpretarPedidoVoz('/voz ligar').acao, 'ligar');
  assert.equal(interpretarPedidoVoz('/voz off').acao, 'desligar');
});

test('textoVozStatus não vaza segredo e descreve backend', () => {
  assert.match(textoVozStatus({}, { ligada: false }), /VOICEBOX=0/);
  assert.match(textoVozStatus({ ok: false, motivo: 'indisponivel' }, { ligada: true }), /indisponível/);
  const t = textoVozStatus({ ok: true, alvo: 'pc' }, { ligada: true, modoConversa: true });
  assert.match(t, /PC \(acelerador\)/);
  assert.match(t, /áudio/);
  assert.doesNotMatch(t, /sk-|Bearer|token|senha/i);
});

test('cliente desligado não gera; saudavel reporta desligado', async () => {
  const c = criarClienteVoz({ ligada: false, url: 'http://127.0.0.1:9' });
  assert.equal(c.ativa, false);
  assert.equal((await c.saudavel()).motivo, 'desligado');
  await assert.rejects(() => c.gerar('oi'), /VOICEBOX=0/);
});

test('prefere o PC quando saudável e cai na VPS se o PC cair; fila de 1', async () => {
  const vpsS = servidor({ ok: true, atrasarMs: 80 });
  const pcS = servidor({ ok: true });
  const vpsAddr = await listen(vpsS);
  const pcAddr = await listen(pcS);
  const vpsUrl = `http://127.0.0.1:${vpsAddr.port}`;
  const pcUrl = `http://127.0.0.1:${pcAddr.port}`;
  try {
    const spawnFn = () => fakeProc(OGG, 0);
    const c = criarClienteVoz({
      ligada: true, url: vpsUrl, urlPc: pcUrl, timeoutMs: 3000, cacheMs: 0, spawnFn,
    });
    const s = await c.saudavel();
    assert.equal(s.ok, true);
    assert.equal(s.alvo, 'pc');

    const audio = await c.gerar('Olá, este é um teste em português.');
    assert.equal(audio.alvo, 'pc');
    assert.ok(audio.ogg.equals(OGG));
    assert.ok(audio.ms >= 0);

    await new Promise(r => pcS.close(r));
    const s2 = await c.saudavel();
    assert.equal(s2.ok, true);
    assert.equal(s2.alvo, 'vps');
    const audio2 = await c.gerar('segundo');
    assert.equal(audio2.alvo, 'vps');

    const ordem = [];
    const atrasado = criarClienteVoz({
      ligada: true, url: vpsUrl, cacheMs: 0, timeoutMs: 3000,
      spawnFn: () => fakeProc(OGG, 0),
    });
    const a = atrasado.gerar('um').then(r => { ordem.push('um'); return r; });
    const b = atrasado.gerar('dois').then(r => { ordem.push('dois'); return r; });
    await Promise.all([a, b]);
    assert.deepEqual(ordem, ['um', 'dois']);
    assert.ok(vpsS._gerarCount() >= 3);
  } finally {
    await new Promise(r => vpsS.close(r));
  }
});

test('timeout da geração vira erro voicebox: tempo esgotado', async () => {
  const vpsS = servidor({ ok: true, atrasarMs: 400 });
  const addr = await listen(vpsS);
  try {
    const c = criarClienteVoz({
      ligada: true, url: `http://127.0.0.1:${addr.port}`, timeoutMs: 50, cacheMs: 0,
      spawnFn: () => fakeProc(OGG, 0),
    });
    await assert.rejects(() => c.gerar('oi'), /tempo esgotado/);
  } finally { await new Promise(r => vpsS.close(r)); }
});

test('se /generate/stream exige download, cai em /generate + /history + /audio', async () => {
  const s = servidor({ ok: true, streamOk: false });
  const addr = await listen(s);
  try {
    const c = criarClienteVoz({
      ligada: true, url: `http://127.0.0.1:${addr.port}`, timeoutMs: 3000, cacheMs: 0,
      spawnFn: () => fakeProc(OGG, 0),
    });
    const audio = await c.gerar('Olá');
    assert.ok(audio.ogg.equals(OGG));
    assert.equal(s._gerarCount(), 1);
  } finally { await new Promise(r => s.close(r)); }
});
