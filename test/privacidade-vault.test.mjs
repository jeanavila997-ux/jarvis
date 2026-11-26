// Notas marcadas como privadas nunca entram no prompt de um modelo externo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Indice, notaPrivada, politicaNuvem, trechosParaNuvem } from '../src/retrieval.mjs';

test('notaPrivada reconhece sensibilidade, nuvem: nao e tags', () => {
  assert.equal(notaPrivada({ sensibilidade: 'privada' }), true);
  assert.equal(notaPrivada({ sensibilidade: 'Confidencial' }), true);
  assert.equal(notaPrivada({ sensibilidade: 'sensível' }), true);
  assert.equal(notaPrivada({ nuvem: 'não' }), true);
  assert.equal(notaPrivada({ nuvem: 'false' }), true);
  assert.equal(notaPrivada({ tags: '[projeto, privado]' }), true);
  assert.equal(notaPrivada({ tags: 'confidencial' }), true);
  assert.equal(notaPrivada({ sensibilidade: 'publica', nuvem: 'sim', tags: 'projeto' }), false);
  assert.equal(notaPrivada({ tags: 'privacidade' }), false, 'só a tag exata conta');
  assert.equal(notaPrivada({}), false);
});

test('politicaNuvem cai no padrão seguro com valor inválido', () => {
  assert.equal(politicaNuvem(undefined), 'sem-privadas');
  assert.equal(politicaNuvem('qualquer'), 'sem-privadas');
  assert.equal(politicaNuvem(' NADA '), 'nada');
  assert.equal(politicaNuvem('tudo'), 'tudo');
});

test('índice marca trechos privados e o filtro os retira da nuvem', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-'));
  try {
    await writeFile(path.join(dir, 'publica.md'), '---\ntitle: Ração\n---\nFormulação de ração para bezerros.');
    await writeFile(path.join(dir, 'cliente.md'), '---\ntitle: Cliente\nsensibilidade: confidencial\n---\nRação do cliente X com preço combinado.');
    await writeFile(path.join(dir, 'lista.md'), '---\ntags:\n  - fazenda\n  - privado\n---\nRação da fazenda e custos.');
    const idx = new Indice(dir);
    const r = await idx.reindexar();
    assert.equal(r.notas, 3);
    assert.equal(r.privadas, 2);

    const trechos = idx.buscar('ração');
    assert.equal(trechos.length, 3, 'a busca local continua vendo tudo');

    const fora = trechosParaNuvem(trechos, 'sem-privadas');
    assert.deepEqual(fora.map(t => t.nota), ['publica']);
    assert.equal(trechosParaNuvem(trechos, 'nada').length, 0);
    assert.equal(trechosParaNuvem(trechos, 'tudo').length, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
