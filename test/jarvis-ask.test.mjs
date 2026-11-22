// Testes da ponte Codex → JARVIS (sem a VPS de verdade).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ehLoopback, validarDestino, juntarNdjson, main } from '../codex/bin/jarvis-ask.mjs';

test('juntarNdjson: junta deltas e captura conversa, fontes e erro', () => {
  const nd = [
    { tipo: 'inicio', conversaId: 'abc', modelo: 'glm' },
    { tipo: 'rota', rota: 'regras', modelo: 'regras' },
    { tipo: 'delta', texto: 'Olá, ' },
    { tipo: 'delta', texto: 'Jean.' },
    { tipo: 'fontes', fontes: ['nota-1'] },
    { tipo: 'erro', mensagem: 'nuvem falhou' },
    { tipo: 'fim' },
  ].map(o => JSON.stringify(o)).join('\n') + '\nlinha-invalida\n';
  const r = juntarNdjson(nd);
  assert.equal(r.resposta, 'Olá, Jean.');
  assert.equal(r.conversaId, 'abc');
  assert.deepEqual(r.fontes, ['nota-1']);
  assert.equal(r.erro, 'nuvem falhou');
  assert.equal(r.rota.rota, 'regras');
});

test('validarDestino: recusa http com senha fora do loopback; aceita https e loopback', () => {
  assert.equal(ehLoopback('http://127.0.0.1:3200'), true);
  assert.equal(ehLoopback('http://localhost:3200'), true);
  assert.equal(ehLoopback('https://jarvis.72-62-11-116.sslip.io'), false);
  assert.equal(validarDestino('https://jarvis.72-62-11-116.sslip.io', { user: 'jean', pass: 'x' }),
    'https://jarvis.72-62-11-116.sslip.io');
  assert.equal(validarDestino('http://127.0.0.1:3200', { user: 'jean', pass: 'x' }),
    'http://127.0.0.1:3200');
  assert.equal(validarDestino('http://127.0.0.1:3200', {}), 'http://127.0.0.1:3200');
  assert.throws(
    () => validarDestino('http://exemplo.invalid', { user: 'jean', pass: 'segredo' }),
    /http:\/\/ com senha fora do loopback/,
  );
  assert.throws(
    () => validarDestino('http://jean:segredo@exemplo.invalid/'),
    /não aceite usuário\/senha na URL/i,
  );
});

function ouvir(handler) {
  return new Promise(resolve => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
function coletor() {
  const o = { out: '', err: '' };
  return { io: { stdout: { write: s => { o.out += s; } }, stderr: { write: s => { o.err += s; } } }, o };
}

test('jarvis-ask: POST /api/chat com X-Jarvis, recusa http+senha remoto, e GET /api/saude', async () => {
  let vistoChat = null;
  const s = await ouvir((req, res) => {
    if (req.method === 'POST' && req.url === '/api/chat') {
      vistoChat = { jarvis: req.headers['x-jarvis'], auth: Boolean(req.headers.authorization) };
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
      res.end([
        { tipo: 'inicio', conversaId: 'c1' },
        { tipo: 'delta', texto: 'No ar.' },
        { tipo: 'fim' },
      ].map(o => JSON.stringify(o) + '\n').join(''));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/saude') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, versao: '0.2.0' }));
      return;
    }
    res.writeHead(404); res.end();
  });
  const porta = s.address().port;
  const url = `http://127.0.0.1:${porta}`;
  try {
    const a = coletor();
    const ca = await main(['oi'], { JARVIS_URL: url, JARVIS_USER: '', JARVIS_PASS: '', JARVIS_TIMEOUT_MS: '5000' }, a.io);
    assert.equal(ca, 0);
    assert.equal(a.o.out.trim(), 'No ar.');
    assert.equal(vistoChat.jarvis, '1');
    assert.equal(vistoChat.auth, false);

    const b = coletor();
    const cb = await main(['saude', '--json'], { JARVIS_URL: url, JARVIS_TIMEOUT_MS: '5000' }, b.io);
    assert.equal(cb, 0);
    assert.match(b.o.out, /"ok":\s*true/);

    const c = coletor();
    const cc = await main(['oi'], {
      JARVIS_URL: 'http://exemplo.invalid', JARVIS_USER: 'jean', JARVIS_PASS: 'segredo',
    }, c.io);
    assert.equal(cc, 2);
    assert.match(c.o.err, /http:\/\/ com senha fora do loopback/);
  } finally { s.close(); }
});
