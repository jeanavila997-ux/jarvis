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

test('criarGrafo: fonte do turno vira nó e co-citação vira arco (dados puro JSON)', async () => {
  const { criarGrafo, tocarTurno } = await importar();
  const g = criarGrafo();
  tocarTurno(g, ['a', 'b'], 'texto sem wikilinks');
  const ids = g.nos.map(n => n.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
  const arco = g.arcos.find(e => (e.de === 'a' && e.para === 'b') || (e.de === 'b' && e.para === 'a'));
  assert.ok(arco, 'co-citação não virou arco');
  assert.equal(arco.peso, 1);
});

test('criarGrafo: wikilink nos trechos cria vizinho e arco com peso maior', async () => {
  const { criarGrafo, tocarTurno } = await importar();
  const g = criarGrafo();
  tocarTurno(g, ['a'], 'consulte [[b]] e [[b]]');
  assert.deepEqual(g.nos.map(n => n.id).sort(), ['a', 'b']);
  const arco = g.arcos[0];
  assert.deepEqual([arco.de, arco.para].sort(), ['a', 'b']);
  assert.equal(arco.peso, 4); // wikilink 2 por ocorrência × 2 ocorrências
});

test('criarGrafo: pesos acumulam entre turnos (dedupe, nada duplicado)', async () => {
  const { criarGrafo, tocarTurno } = await importar();
  const g = criarGrafo();
  tocarTurno(g, ['a', 'b'], '');
  tocarTurno(g, ['a', 'b'], '');
  assert.equal(g.nos.length, 2);
  assert.equal(g.nos.find(n => n.id === 'a').peso, 2);
  assert.equal(g.arcos.length, 1);
  assert.equal(g.arcos[0].peso, 2);
});

test('criarGrafo: nome vazio/inválido é rejeitado; JSON puro serializável e religável', async () => {
  const { criarGrafo, tocarTurno } = await importar();
  const g = criarGrafo();
  tocarTurno(g, ['', 'a', 'a'], '[[   ]]');
  assert.deepEqual(g.nos.map(n => n.id), ['a']);
  const texto = JSON.stringify(g);
  const g2 = JSON.parse(texto);
  tocarTurno(g2, ['a', 'z'], '');
  assert.deepEqual(g2.nos.map(n => n.id).sort(), ['a', 'z']);
  assert.equal(g2.nos.find(n => n.id === 'a').peso, 2); // pesou de onde paramos
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
