import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { criarClienteHermes, interpretarPedidoHermes, textoHermesStatus, ACOES_NIVEL2 } from '../src/hermes.mjs';

test('interpretarPedidoHermes: leitura vs nível 2, e ignora texto sem hermes', () => {
  assert.equal(interpretarPedidoHermes('qual o status do n8n?'), null);
  assert.equal(interpretarPedidoHermes('status do hermes').acao, 'status');
  assert.equal(interpretarPedidoHermes('status do hermes').nivel, 0);
  assert.equal(interpretarPedidoHermes('/hermes').acao, 'status');
  assert.equal(interpretarPedidoHermes('lista as tarefas do hermes').acao, 'tarefas');
  assert.equal(interpretarPedidoHermes('lista as tarefas do hermes').nivel, 0);
  const p = interpretarPedidoHermes('pausa a tarefa abc123 do hermes');
  assert.equal(p.acao, 'pausar');
  assert.equal(p.nivel, 2);
  assert.equal(p.id, 'abc123');
  const r = interpretarPedidoHermes('roda agora a tarefa job_9 do hermes');
  assert.equal(r.acao, 'rodar');
  assert.equal(r.nivel, 2);
  assert.ok(ACOES_NIVEL2.includes('apagar'));
  const a = interpretarPedidoHermes('apaga a tarefa xyz do hermes');
  assert.equal(a.acao, 'apagar');
  assert.equal(a.nivel, 2);
  assert.equal(interpretarPedidoHermes('pausa o hermes').erro, 'informe o id da tarefa');
});

test('textoHermesStatus não vaza segredos e formata leitura', () => {
  assert.match(textoHermesStatus({ ok: false, motivo: 'indisponivel' }), /indisponível/);
  const t = textoHermesStatus({ ok: true, versao: '0.23.1', plataforma: 'hermes-agent' }, [
    { id: 'a1', nome: 'briefing', estado: 'ok', agendamento: '30 6 * * *' },
  ]);
  assert.match(t, /0\.23\.1/);
  assert.match(t, /briefing/);
  assert.doesNotMatch(t, /Bearer|API_SERVER_KEY|token/i);
});

test('cliente: /health sem chave; mutações e listagem exigem chave; 401 não loga chave', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', platform: 'hermes-agent', version: '0.23.1' }));
    }
    if (req.headers.authorization !== 'Bearer chave-teste') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid gateway API key (API_SERVER_KEY)', type: 'gateway_auth_error' } }));
    }
    if (req.url === '/api/jobs' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ jobs: [{ id: 'j1', name: 'rotina', paused: false, schedule: '0 6 * * *' }] }));
    }
    if (req.url === '/api/jobs/j1/pause' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, id: 'j1', state: 'paused' }));
    }
    res.writeHead(404); res.end();
  });
  const addr = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address())));
  const url = `http://127.0.0.1:${addr.port}`;
  try {
    const semChave = criarClienteHermes({ ligada: true, url, apiKey: '' });
    const s = await semChave.saudavel();
    assert.equal(s.ok, true);
    assert.equal(s.versao, '0.23.1');
    await assert.rejects(() => semChave.listarTarefas(), /HERMES_API_KEY ausente/);

    const comChave = criarClienteHermes({ ligada: true, url, apiKey: 'chave-teste' });
    const jobs = await comChave.listarTarefas();
    assert.equal(jobs[0].id, 'j1');
    assert.equal(jobs[0].nome, 'rotina');
    const pausado = await comChave.executar({ acao: 'pausar', id: 'j1' });
    assert.equal(pausado.state, 'paused');

    const ruim = criarClienteHermes({ ligada: true, url, apiKey: 'errada' });
    await assert.rejects(() => ruim.listarTarefas(), /401/);
    assert.ok(seen.some(x => x.url === '/health' && x.auth === ''));
    assert.ok(seen.some(x => x.url === '/api/jobs' && x.auth === 'Bearer chave-teste'));
    assert.ok(seen.some(x => x.url === '/api/jobs/j1/pause' && x.method === 'POST'));
  } finally { await new Promise(r => server.close(r)); }
});

test('cliente desligado não abre rede', async () => {
  const c = criarClienteHermes({ ligada: false, url: 'http://127.0.0.1:1' });
  const s = await c.saudavel();
  assert.deepEqual(s, { ok: false, motivo: 'desligado' });
});
