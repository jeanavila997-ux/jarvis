// Etapa 2 — src/config.mjs: camadas default→env→arquivo, máscara de segredos, merge profundo, write atômico.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHAVE = 'sk_test_valor_super_secreto_9f8a';
const SUFIXO_OK = '…9f8a';

async function dirTemp() { return mkdtemp(path.join(tmpdir(), 'jarvis-config-')); }
const ENV = (extra = {}) => ({ OLLAMA_URL: 'https://cloud.test', OLLAMA_API_KEY: CHAVE, JARVIS_MODEL: 'modelo-env', ...extra });

test('camadas: default → env → arquivo (definir sobrescreve model, env mantém url e apiKey)', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV() });
  let r = await cfg.resolvido();
  assert.equal(r.ollamaCloud.url, 'https://cloud.test');
  assert.equal(r.ollamaCloud.model, 'modelo-env');
  assert.equal(r.ollamaCloud.apiKey, CHAVE);
  await cfg.definir(JSON.parse('{"apis":{"ollamaCloud":{"model":"modelo-config"}}}'));
  r = await cfg.resolvido();
  assert.equal(r.ollamaCloud.model, 'modelo-config');
  assert.equal(r.ollamaCloud.url, 'https://cloud.test');
  assert.equal(r.ollamaCloud.apiKey, CHAVE);
});

test('máscara: listar() só traz {configurado, sufixo, fonte} e nunca o valor do segredo', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV({ NINEROUTER_API_KEY: 'nr_outra_chave_1234' }) });
  const l = await cfg.listar();
  const k = l.apis.ollamaCloud.apiKey;
  assert.deepEqual(Object.keys(k).sort(), ['configurado', 'fonte', 'sufixo']);
  assert.equal(k.configurado, true);
  assert.equal(k.sufixo, SUFIXO_OK);
  assert.equal(k.fonte, 'env');
  const nr = l.apis.ninerouter.apiKey;
  assert.equal(nr.sufixo, '…1234');
  assert.equal(nr.fonte, 'env');
  const texto = JSON.stringify(l);
  assert.ok(!texto.includes(CHAVE), 'valor pleno vazou na listagem');
  assert.ok(!texto.includes('nr_outra_chave_1234'), 'segundo segredo vazou na listagem');
  // segredo ausente: configurado false, sufixo null, fonte default
  const codex = l.apis.codex.apiKey;
  assert.deepEqual(codex, { configurado: false, sufixo: null, fonte: 'default' });
});

test('definir com segredo vazio ou ausente mantém o valor anterior', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  let cfg = criarConfig({ dataDir, env: ENV() });
  await cfg.definir(JSON.parse('{"apis":{"ollamaCloud":{"apiKey":""}}}'));
  let l = await cfg.listar();
  assert.equal(l.apis.ollamaCloud.apiKey.configurado, true);
  assert.equal(l.apis.ollamaCloud.apiKey.sufixo, SUFIXO_OK);
  // reabrir sem env de segredo: o valor da config (mantido de env) ainda está lá
  cfg = criarConfig({ dataDir, env: { OLLAMA_URL: 'https://cloud.test' } });
  l = await cfg.listar();
  assert.equal(l.apis.ollamaCloud.apiKey.configurado, true);
  assert.equal(l.apis.ollamaCloud.apiKey.fonte, 'config');
});

test('merge profundo: definir só de model preserva url/apiKey/timestamps e outras seções', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  const cfg = criarConfig({ dataDir, env: ENV({ HERMES_URL: 'https://hermes.test', NINEROUTER_RESERVA: '1' }) });
  await cfg.definir(JSON.parse('{"apis":{"ollamaCloud":{"model":"novo"}}}'));
  const r = await cfg.resolvido();
  assert.equal(r.hermes.ligada, true);
  assert.equal(r.ninerouter.ligada, true);
  assert.equal(r.ollamaCloud.apiKey, CHAVE);
  assert.equal(r.ollamaCloud.model, 'novo');
});

test('gravação atômica: config.json existe e nenhum *.tmp sobra; persiste em nova instância', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  let cfg = criarConfig({ dataDir, env: ENV() });
  await cfg.definir(JSON.parse('{"apis":{"ollamaCloud":{"model":"persistido"}}}'));
  const arq = path.join(dataDir, 'config.json');
  await readFile(arq, 'utf8');
  for (const f of await readdir(dataDir)) assert.ok(!f.endsWith('.tmp'), `tmp sobrou: ${f}`);
  cfg = criarConfig({ dataDir, env: ENV() });
  assert.equal((await cfg.resolvido()).ollamaCloud.model, 'persistido');
});

test('arquivo corrompido: resolvido()/listar() caem para env/defaults sem lançar', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  await writeFile(path.join(dataDir, 'config.json'), 'isto-nao-e-json', 'utf8');
  const cfg = criarConfig({ dataDir, env: ENV() });
  const r = await cfg.resolvido();
  assert.equal(r.ollamaCloud.model, 'modelo-env');
  await assert.doesNotReject(() => cfg.listar());
});

test('definir rejeita corpo inválido e não grava nada', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  const cfg = criarConfig({ dataDir, env: ENV() });
  await assert.rejects(() => cfg.definir(42));
  // __proto__ via JSON parse (chave própria, como viria da rede)
  await assert.rejects(() => cfg.definir(JSON.parse('{"__proto__":{"x":1}}')));
  await assert.rejects(() => cfg.definir(JSON.parse('{"apis":{"codex":{"apiKey":5}}}')));
  await assert.rejects(() => cfg.definir(JSON.parse('{"apis":{"codex":{"campoDesconhecido":1}}}')));
  await assert.rejects(() => cfg.definir(JSON.parse('{"apis":{"ollamaCloud":{"ligada":"sim"}}}')));
  // nada foi gravado
  await assert.rejects(() => readFile(path.join(dataDir, 'config.json'), 'utf8'), { code: 'ENOENT' });
});

// ---------- Task 2: probes "Testar agora" ----------

function resposta(status, corpo, cabecalhos = {}) {
  return new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), { status, headers: cabecalhos });
}

test('probe ollamaNativo: GET /api/tags e detalhe com contagem de modelos', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const pedidos = [];
  const fetchFn = async (url, op = {}) => { pedidos.push({ url, op }); return resposta(200, { models: [{ name: 'a' }, { name: 'b' }] }); };
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV(), fetchFn });
  const r = await cfg.testar('ollamaNativo');
  assert.equal(pedidos[0].url, 'http://host.docker.internal:11434/api/tags');
  assert.equal(r.ok, true);
  assert.match(r.detalhe, /2/);
  assert.ok(r.ms >= 0);
});

test('probe opencodeGo: GET /models com Authorization Bearer', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const dataDir = await dirTemp();
  let cfg = criarConfig({ dataDir, env: ENV(), fetchFn: null });
  cfg = criarConfig({ dataDir, env: ENV(), fetchFn: async (url, op = {}) => {
    assert.equal(url, 'https://opencode.ai/inference/go/openai/v1/models');
    assert.equal(op.headers?.authorization, 'Bearer oc_sk_TESTE_chave_1234');
    return resposta(200, { data: [{ id: 'kimi-k3' }] });
  } });
  await cfg.definir(JSON.parse('{"apis":{"opencodeGo":{"apiKey":"oc_sk_TESTE_chave_1234","ligada":true}}}'));
  const r = await cfg.testar('opencodeGo');
  assert.equal(r.ok, true);
  assert.match(r.detalhe, /kimi-k3|1/);
});

test('probe codex: GET /v1/models Bearer', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const urls = [];
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV(), fetchFn: async (url) => { urls.push(url); return resposta(200, { data: [{ id: 'gpt-5.3-codex' }] }); } });
  await cfg.definir(JSON.parse('{"apis":{"codex":{"apiKey":"sk_codex_0001","ligada":true}}}'));
  const r = await cfg.testar('codex');
  assert.equal(urls[0], 'https://api.openai.com/v1/models');
  assert.equal(r.ok, true);
});

test('probe ninerouter: health sem /v1 (raiz + /api/health)', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const urls = [];
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV({ NINEROUTER_URL: 'https://nr.test/v1', NINEROUTER_RESERVA: '1' }), fetchFn: async (url) => { urls.push(url); return resposta(200, { ok: true }); } });
  const r = await cfg.testar('ninerouter');
  assert.equal(urls[0], 'https://nr.test/api/health');
  assert.equal(r.ok, true);
});

test('probe hermes: GET {url}/health', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const urls = [];
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV({ HERMES_URL: 'https://hermes.test' }), fetchFn: async (url) => { urls.push(url); return resposta(200, { ok: true }); } });
  const r = await cfg.testar('hermes');
  assert.equal(urls[0], 'https://hermes.test/health');
  assert.equal(r.ok, true);
});

test('probes nvidia e github chamam callbacks injetáveis', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV({ NVIDIA_APP: '1', DOCKER_MCP: '1' }), fetchFn: async () => resposta(500, 'não deve ser chamado'),
    probes: { nvidia: async () => ({ ok: true, detalhe: '6 ferramentas' }), github: async () => ({ ok: false, detalhe: 'gateway fora' }) } });
  const n = await cfg.testar('nvidia');
  assert.equal(n.ok, true);
  assert.match(n.detalhe, /6 ferramentas/);
  const g = await cfg.testar('github');
  assert.equal(g.ok, false);
  assert.match(g.detalhe, /gateway fora/);
});

test('probe 401: ok false e mensagem "chave recusada (401)" sem ecoar o valor', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const SEGREDO = 'oc_sk_falha_abcdef';
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV(), fetchFn: async () => resposta(401, `{"error":{"message":"bad key ${SEGREDO}"}}`) });
  await cfg.definir(JSON.parse(`{"apis":{"opencodeGo":{"apiKey":"${SEGREDO}","ligada":true}}}`));
  const r = await cfg.testar('opencodeGo');
  assert.equal(r.ok, false);
  assert.match(r.detalhe, /chave recusada \(401\)/);
  assert.ok(!JSON.stringify(r).includes(SEGREDO), 'detalhe ecoou a chave');
});

test('erro de probe com o valor da chave no corpo é sanitizado', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const SEGREDO = 'sk_sanitiza_9f8a7b';
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV(), fetchFn: async () => resposta(500, `explode: ${SEGREDO} interno`) });
  await cfg.definir(JSON.parse(`{"apis":{"codex":{"apiKey":"${SEGREDO}","ligada":true}}}`));
  const r = await cfg.testar('codex');
  assert.ok(!r.detalhe.includes(SEGREDO), 'sanitização faltou');
  assert.match(r.detalhe, /\[chave\]|500/);
});

test('testar(id) com id desconhecido lança', async () => {
  const { criarConfig } = await import('../src/config.mjs');
  const cfg = criarConfig({ dataDir: await dirTemp(), env: ENV() });
  await assert.rejects(() => cfg.testar('naoexiste'), /id desconhecido/);
});
