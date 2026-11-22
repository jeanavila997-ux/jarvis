import test from 'node:test';
import assert from 'node:assert/strict';
import { nivelFerramenta, criarClienteMestre, textoMestreStatus, FERRAMENTAS_NIVEL2 } from '../src/mestre-mcp.mjs';
import { Confirmacoes } from '../src/confirmacoes.mjs';

test('níveis: leitura 0, as 4 ações 2, fora da lista e destrutivo 3', () => {
  for (const n of ['status', 'list_operations', 'list_memories']) assert.equal(nivelFerramenta(n).nivel, 0);
  for (const n of ['save_memory', 'optimize_ram_and_temp', 'ask_grok']) assert.equal(nivelFerramenta(n, { texto: 'x' }).nivel, 2);
  assert.deepEqual([...FERRAMENTAS_NIVEL2].sort(), ['ask_grok', 'optimize_ram_and_temp', 'run_operation', 'save_memory']);
  assert.equal(nivelFerramenta('run_operation', { operation: 'diagnosticar_rede' }).nivel, 2);
  assert.equal(nivelFerramenta('run_operation', { operation: 'limpar_temp' }).nivel, 2);
  for (const op of ['apagar_backups', 'delete_files', 'formatar_disco', 'desativar_firewall', 'disable_defender', 'vssadmin_delete_shadows', 'remover_programa', 'mostrar_senhas_wifi'])
    assert.equal(nivelFerramenta('run_operation', { operation: op }).nivel, 3, op);
  assert.equal(nivelFerramenta('run_operation', { operation: 'rede', args: { cmd: 'rm -rf C:/x' } }).nivel, 3);
  assert.equal(nivelFerramenta('run_operation', {}).nivel, 3);
  assert.equal(nivelFerramenta('shell_exec').nivel, 3);
  assert.equal(nivelFerramenta('nome_novo', {}, { extraLeitura: ['nome_novo'] }).nivel, 0);
});

function servidorFalso({ semSessao = false, registro = [] } = {}) {
  return async (path, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : {};
    registro.push({ path, method: body.method, auth: opts.headers?.authorization, tok: opts.headers?.['x-mcp-token'] });
    const h = new Headers({ 'content-type': 'application/json', ...(semSessao ? {} : { 'mcp-session-id': 's1' }) });
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { capabilities: {} } }), { status: 200, headers: h });
    if (body.method === 'notifications/initialized') return new Response('', { status: 202, headers: h });
    if (body.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: ['status', 'list_operations', 'list_memories', ...FERRAMENTAS_NIVEL2].map(name => ({ name })) } }), { status: 200, headers: h });
    if (body.method === 'tools/call') return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `ok ${body.params.name}` }] } })}\n\n`, { status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }) });
    return new Response('{}', { status: 404 });
  };
}

test('desligado por padrão: não faz rede', async () => {
  const c = criarClienteMestre({ url: 'unix:///app/run/mestre.sock' });
  assert.equal(c.ativa, false);
  assert.equal((await c.saudavel()).motivo, 'desligado');
  assert.match(textoMestreStatus(await c.saudavel()), /desligado/);
});

for (const semSessao of [false, true]) test(`leitura nível 0 executa direto (semSessao=${semSessao}) e manda token`, async () => {
  const registro = [];
  const c = criarClienteMestre({ ligada: true, url: 'unix:///x.sock', token: 'T0K', fetchFn: servidorFalso({ semSessao, registro }) });
  const s = await c.saudavel();
  assert.equal(s.ok, true);
  assert.match(textoMestreStatus(s), /Leitura \(nível 0\): status, list_operations, list_memories/);
  assert.equal((await c.ler('status')).texto, 'ok status');
  await assert.rejects(c.ler('run_operation', { operation: 'x' }), /nível 2/);
  assert.ok(registro.every(r => r.auth === 'Bearer T0K' && r.tok === 'T0K'));
});

test('nível 2 passa por Confirmacoes; nível 3 é recusado sem criar botão', async () => {
  const registro = [], audit = [];
  const c = criarClienteMestre({ ligada: true, url: 'unix:///x.sock', fetchFn: servidorFalso({ registro }) });
  const conf = new Confirmacoes({ auditar: e => audit.push(e) });
  const p = c.prepararAcao({ confirmacoes: conf, nome: 'optimize_ram_and_temp', chatId: '42' });
  assert.equal(p.nivel, 2); assert.ok(p.id);
  assert.equal(registro.filter(r => r.method === 'tools/call').length, 0, 'nada executa antes do sim');
  const r = await conf.resolver(p.id, { confirmar: true, chatId: '42' });
  assert.equal(r.ok, true); assert.match(r.msg, /ok optimize_ram_and_temp/);
  assert.equal(registro.filter(r => r.method === 'tools/call').length, 1);
  const p3 = c.prepararAcao({ confirmacoes: conf, nome: 'run_operation', args: { operation: 'apagar_backups' }, chatId: '42', auditar: e => audit.push(e) });
  assert.equal(p3.recusado, true); assert.equal(p3.nivel, 3);
  assert.equal(conf.pendentes('42'), 0);
  assert.ok(audit.some(e => e.resultado === 'recusado-nivel3'));
  const sem = c.prepararAcao({ nome: 'ask_grok', args: { pergunta: 'oi' } });
  assert.equal(sem.recusado, true);
});
