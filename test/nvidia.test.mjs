// Testes do cliente e do proxy allowlist nvidia-app (sem rede real, sem túnel).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { criarClienteNvidia, FERRAMENTAS_LEITURA } from '../src/nvidia.mjs';
import { criarProxy, enderecoPermitido, deveEncaminhar, classificarFerramenta } from '../scripts/nvidia-allowlist-proxy.mjs';

test('Allowlist: só as 6 ferramentas de LEITURA passam', () => {
  assert.equal(FERRAMENTAS_LEITURA.length, 6);
  assert.equal(deveEncaminhar('nvapp_client_get_driver_status', { annotations: { readOnlyHint: true } }), true);
  assert.equal(deveEncaminhar('nvapp_client_launch_application', { annotations: { readOnlyHint: false } }), false);
  assert.equal(deveEncaminhar('nvapp_client_get_driver_status', { annotations: { readOnlyHint: false } }), false); // anotação ao vivo vence
  assert.equal(deveEncaminhar('ferramenta-nova-readonly', { annotations: { readOnlyHint: true } }), false); // fail-closed
  assert.equal(classificarFerramenta({ annotations: { readOnlyHint: true } }, 'x'), 'LEITURA');
  assert.equal(classificarFerramenta({ annotations: { readOnlyHint: false } }, 'x'), 'ESCRITA');
});

test('Bind: recusa endereço público, aceita loopback e IP privado', () => {
  assert.equal(enderecoPermitido('127.0.0.1'), true);
  assert.equal(enderecoPermitido('localhost'), true);
  assert.equal(enderecoPermitido('172.18.0.1'), true);
  assert.equal(enderecoPermitido('10.0.0.4'), true);
  assert.equal(enderecoPermitido('0.0.0.0'), false);
  assert.equal(enderecoPermitido('::'), false);
  assert.equal(enderecoPermitido('*'), false);
  assert.throws(() => criarProxy({ host: '0.0.0.0', token: 't' }), /bind recusado/);
  assert.throws(() => criarProxy({ host: '127.0.0.1' }), /TOKEN/);
});

function mcpMock({ tools, calls = [] }) {
  let session = 'sessao-teste';
  const server = http.createServer((req, res) => {
    const sid = req.headers['mcp-session-id'];
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    const pedacos = [];
    req.on('data', c => pedacos.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(pedacos).toString('utf8') || '{}');
      const headers = { 'content-type': 'application/json' };
      if (body.method === 'initialize') {
        headers['mcp-session-id'] = session;
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'nvidia-app', version: '1.0.0' } } }));
      }
      if (body.method === 'notifications/initialized') { res.writeHead(202, headers); return res.end(); }
      if (body.method === 'tools/list') {
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } }));
      }
      if (body.method === 'tools/call') {
        calls.push({ name: body.params.name, arguments: body.params.arguments, session: sid });
        res.writeHead(200, headers);
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }], structuredContent: { version: '621.24', channel: 'STUDIO' } } }));
      }
      res.writeHead(400, headers);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'metodo' } }));
    });
  });
  return { server, calls, escutar: () => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address()))) };
}

const toolsFicticias = [
  { name: 'nvapp_client_get_driver_status', description: 'driver', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
  { name: 'nvapp_client_launch_application', description: 'launch', inputSchema: { type: 'object', properties: { game: { type: 'string' } }, required: ['game'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false } },
  { name: 'nvapp_client_set_laptop_feature', description: 'set', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } },
];

test('Proxy e cliente: saúde, leitura passa, escrita e token ruim são recusados, escrita não chega no upstream', async () => {
  const mock = mcpMock({ tools: toolsFicticias });
  const addr = await mock.escutar();
  const token = 'token-teste';
  const proxy = criarProxy({
    host: '127.0.0.1',
    port: 0,
    token,
    upstream: `http://127.0.0.1:${addr.port}/mcp`,
  });
  const paddr = await proxy.escutar();
  const base = `http://127.0.0.1:${paddr.port}`;
  try {
    const off = criarClienteNvidia({ ligada: false, url: base, token });
    assert.equal(off.ativa, false);
    assert.equal((await off.saudavel()).motivo, 'desligado');
    await assert.rejects(off.chamar('nvapp_client_get_driver_status'), /desligado/);

    const semToken = criarClienteNvidia({ ligada: true, url: base, token: 'errado' });
    assert.equal((await semToken.saudavel()).motivo, 'token-recusado');

    const cli = criarClienteNvidia({ ligada: true, url: base, token, cacheMs: 60000 });
    assert.equal(cli.ativa, true);
    const s1 = await cli.saudavel();
    const s2 = await cli.saudavel();
    assert.equal(s1.ok, true);
    assert.deepEqual(s1, s2);
    assert.deepEqual(s1.ferramentas, ['nvapp_client_get_driver_status']);

    const lista = await cli.listar();
    assert.equal(lista.length, 1);
    assert.equal(lista[0].name, 'nvapp_client_get_driver_status');

    const out = await cli.chamar('nvapp_client_get_driver_status', {});
    assert.equal(out.result.structuredContent.version, '621.24');
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].name, 'nvapp_client_get_driver_status');

    await assert.rejects(cli.chamar('nvapp_client_launch_application', { game: 'X' }), /não é LEITURA/);
    assert.equal(mock.calls.length, 1); // cliente bloqueou antes

    const r = await fetch(`${base}/ferramenta`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nvapp_client_launch_application', arguments: { game: 'X' } }),
    });
    assert.equal(r.status, 403);
    assert.equal(mock.calls.length, 1); // proxy também não encaminhou
  } finally {
    await proxy.fechar();
    await new Promise(r => mock.server.close(r));
  }
});

test('Cliente recusa ferramenta fora da allowlist mesmo se o proxy estivesse aberto', async () => {
  const cli = criarClienteNvidia({
    ligada: true, url: 'http://127.0.0.1:1', token: 't',
    fetchFn: async () => { throw new Error('não deveria chamar rede'); },
  });
  await assert.rejects(cli.chamar('nvapp_overlay_capture', { action: 'capture_screenshot' }), /não é LEITURA/);
});
