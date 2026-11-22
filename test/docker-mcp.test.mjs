// Testes do cliente Docker MCP Gateway (sem rede real, sem GitHub).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  criarClienteDockerMcp,
  FERRAMENTAS_LEITURA,
  FERRAMENTAS_ESCRITA,
  FERRAMENTAS_DESTRUTIVAS,
  classificarFerramentaGithub,
  podeChamarLeitura,
  podeChamarEscrita,
  nomeCanonico,
} from '../src/docker-mcp.mjs';

test('Allowlist: leitura, escrita e destrutiva estão disjuntas e classificadas', () => {
  assert.ok(FERRAMENTAS_LEITURA.length >= 8);
  assert.ok(FERRAMENTAS_ESCRITA.includes('create_pull_request'));
  assert.ok(FERRAMENTAS_DESTRUTIVAS.includes('delete_file'));
  assert.ok(FERRAMENTAS_DESTRUTIVAS.includes('merge_pull_request'));
  const todos = [...FERRAMENTAS_LEITURA, ...FERRAMENTAS_ESCRITA, ...FERRAMENTAS_DESTRUTIVAS];
  assert.equal(new Set(todos).size, todos.length);
  assert.equal(classificarFerramentaGithub('get_me'), 'LEITURA');
  assert.equal(classificarFerramentaGithub('github-official.get_me'), 'LEITURA');
  assert.equal(classificarFerramentaGithub('create_pull_request'), 'ESCRITA');
  assert.equal(classificarFerramentaGithub('delete_file'), 'DESTRUTIVA');
  assert.equal(classificarFerramentaGithub('ferramenta-nova'), 'DESCONHECIDA');
  assert.equal(podeChamarLeitura('get_me', { annotations: { readOnlyHint: true } }), true);
  assert.equal(podeChamarLeitura('get_me', { annotations: { readOnlyHint: false } }), false);
  assert.equal(podeChamarLeitura('create_pull_request'), false);
  assert.equal(podeChamarEscrita('create_pull_request', { annotations: { readOnlyHint: false } }, { confirmado: false }), false);
  assert.equal(podeChamarEscrita('create_pull_request', { annotations: { readOnlyHint: false } }, { confirmado: true }), true);
  assert.equal(podeChamarEscrita('delete_file', {}, { confirmado: true }), false);
  assert.equal(nomeCanonico('github-official_search_code'), 'search_code');
});

function mcpMock({ tools, calls = [] }) {
  let session = 'sessao-docker-teste';
  const server = http.createServer((req, res) => {
    const sid = req.headers['mcp-session-id'];
    const auth = req.headers['authorization'] || '';
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
      const headers = { 'content-type': 'application/json' };
      if (body.method === 'initialize') {
        if (auth !== 'Bearer token-teste') {
          res.writeHead(401, headers);
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'unauthorized' } }));
        }
        headers['mcp-session-id'] = session;
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'docker-mcp-gateway', version: '2' } } }));
      }
      if (body.method === 'notifications/initialized') { res.writeHead(202, headers); return res.end(); }
      if (body.method === 'tools/list') {
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } }));
      }
      if (body.method === 'tools/call') {
        calls.push({ name: body.params.name, arguments: body.params.arguments, session: sid, auth });
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok-github' }] } }));
      }
      res.writeHead(400, headers);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'metodo' } }));
    });
  });
  return { server, calls, escutar: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address()))) };
}

const toolsFicticias = [
  { name: 'get_me', description: 'perfil', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'search_repositories', description: 'busca', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'create_pull_request', description: 'abre PR', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
  { name: 'delete_file', description: 'apaga', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true } },
];

test('Cliente: desligado, token ruim, leitura passa, escrita e destrutiva são recusadas e não chegam no upstream', async () => {
  const mock = mcpMock({ tools: toolsFicticias });
  const addr = await mock.escutar();
  const url = `http://127.0.0.1:${addr.port}/mcp`;
  try {
    const off = criarClienteDockerMcp({ ligada: false, url, token: 'token-teste' });
    assert.equal(off.ativa, false);
    assert.equal((await off.saudavel()).motivo, 'desligado');
    await assert.rejects(off.chamar('get_me'), /desligado/);

    const semToken = criarClienteDockerMcp({ ligada: true, url, token: '' });
    assert.equal(semToken.ativa, false);
    assert.equal((await semToken.saudavel()).motivo, 'desligado');

    const tokenRuim = criarClienteDockerMcp({ ligada: true, url, token: 'errado', cacheMs: 0 });
    assert.equal((await tokenRuim.saudavel()).ok, false);

    const cli = criarClienteDockerMcp({ ligada: true, url, token: 'token-teste', cacheMs: 60000 });
    assert.equal(cli.ativa, true);
    const s1 = await cli.saudavel();
    const s2 = await cli.saudavel();
    assert.equal(s1.ok, true);
    assert.deepEqual(s1, s2);
    assert.ok(s1.ferramentas.includes('get_me'));
    assert.ok(!s1.ferramentas.includes('delete_file')); // saudavel lista só leitura

    const lista = await cli.listar();
    assert.equal(lista.filter(t => t.classe === 'LEITURA').length, 2);
    assert.equal(lista.find(t => t.name === 'create_pull_request').classe, 'ESCRITA');
    assert.equal(lista.find(t => t.name === 'delete_file').classe, 'DESTRUTIVA');

    const out = await cli.chamar('get_me', {});
    assert.equal(out.result.content[0].text, 'ok-github');
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].name, 'get_me');

    await assert.rejects(cli.chamar('create_pull_request', { title: 'x' }), /nível 2|confirmação/);
    assert.equal(mock.calls.length, 1);

    const escrito = await cli.chamar('create_pull_request', { title: 'x' }, { confirmado: true });
    assert.equal(escrito.result.content[0].text, 'ok-github');
    assert.equal(mock.calls.length, 2);
    assert.equal(mock.calls[1].name, 'create_pull_request');

    await assert.rejects(cli.chamar('delete_file', { path: 'x' }, { confirmado: true }), /nível 3|proibida/);
    assert.equal(mock.calls.length, 2); // destrutiva não chegou no upstream

    await assert.rejects(cli.chamar('ferramenta-inventada', {}), /desconhecida|recusou/);
    assert.equal(mock.calls.length, 2);
  } finally {
    await new Promise(r => mock.server.close(r));
  }
});

test('Cliente recusa escrita e destrutiva sem abrir rede', async () => {
  const cli = criarClienteDockerMcp({
    ligada: true, url: 'http://127.0.0.1:1', token: 't',
    fetchFn: async () => { throw new Error('não deveria chamar rede'); },
  });
  await assert.rejects(cli.chamar('create_pull_request', {}), /confirmação|nível 2/);
  await assert.rejects(cli.chamar('delete_file', {}), /nível 3|proibida/);
});
