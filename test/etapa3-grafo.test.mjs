// Etapa 3 — src/grafo.mjs: wikilinks, nós/arcos por turno, co-citação, dedupe com peso.
import test from 'node:test';
import assert from 'node:assert/strict';

const importar = () => import('../src/grafo.mjs');

test('extrairWikilinks: [[nome]] e [[nome|alias]], dedupe e filtro de vazio/traversal', async () => {
  const { extrairWikilinks } = await importar();
  assert.deepEqual(
    extrairWikilinks('Veja [[README]] e [[Projeto X|o projeto]] e de novo [[README]].'),
    ['README', 'Projeto X']
  );
  assert.deepEqual(extrairWikilinks('nada aqui'), []);
  assert.deepEqual(extrairWikilinks('[[]], [[ .. ], [[ok]]'), ['ok']);
});

test('criarGrafo: fontes do turno viram nós e co-citação vira arco', async () => {
  const { criarGrafo } = await importar();
  const g = criarGrafo();
  g.registrarTurno(['a', 'b'], 'texto sem wikilinks');
  const r = g.resumo();
  const ids = r.nos.map(n => n.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
  const arco = r.arcos.find(e => (e.de === 'a' && e.para === 'b') || (e.de === 'b' && e.para === 'a'));
  assert.ok(arco, 'co-citação não virou arco');
  assert.equal(arco.peso, 1);
});

test('criarGrafo: wikilink nos trechos cria vizinho e arco com peso maior', async () => {
  const { criarGrafo } = await importar();
  const g = criarGrafo();
  g.registrarTurno(['a'], 'consulte [[b]] e [[b]]');
  const r = g.resumo();
  assert.deepEqual(r.nos.map(n => n.id).sort(), ['a', 'b']);
  const arco = r.arcos[0];
  assert.deepEqual([arco.de, arco.para].sort(), ['a', 'b']);
  assert.equal(arco.peso, 4); // wikilink 2 por ocorrência × 2 ocorrências
});

test('criarGrafo: pesos acumulam entre turnos (dedupe, nada duplicado)', async () => {
  const { criarGrafo } = await importar();
  const g = criarGrafo();
  g.registrarTurno(['a', 'b'], '');
  g.registrarTurno(['a', 'b'], '');
  const r = g.resumo();
  assert.equal(r.nos.length, 2);
  assert.equal(r.nos.find(n => n.id === 'a').peso, 2);
  const arcos = r.arcos;
  assert.equal(arcos.length, 1);
  assert.equal(arcos[0].peso, 2);
});

test('criarGrafo: nome vazio/válido é rejeitado; resumo é serializável', async () => {
  const { criarGrafo } = await importar();
  const g = criarGrafo();
  g.registrarTurno(['', 'a', 'a'], '[[   ]]');
  const r = g.resumo();
  assert.deepEqual(r.nos.map(n => n.id), ['a']);
  assert.doesNotThrow(() => JSON.stringify(r));
});

test('acharNota: acha .md por nome no vault, recusa traversal e 404', async () => {
  const { acharNota } = await importar();
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const raiz = await mkdtemp(path.join(tmpdir(), 'vault-'));
  await writeFile(path.join(raiz, 'Pendências.md'), '# Pendências\n[[Fechado]]');
  await mkdir(path.join(raiz, 'sub'));
  await writeFile(path.join(raiz, 'sub', 'Aninhado.md'), 'x');
  const a = await acharNota(raiz, 'Pendências');
  assert.ok(a && a.toLowerCase().endsWith('pendências.md'));
  assert.equal(await acharNota(raiz, 'Inexistente'), null);
  assert.equal(await acharNota(raiz, '..'), null);
  assert.equal(await acharNota(raiz, 'sub/Aninhado'), null); // só basename, sem path
});
