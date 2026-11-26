// Notas marcadas como privadas nunca entram no prompt de um modelo externo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Indice, notaPrivada, marcaPrivadaNoTexto, politicaNuvem, trechosParaNuvem, buscarParaFora, planejarContexto } from '../src/retrieval.mjs';

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

async function comVault(arquivos, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-'));
  try {
    for (const [nome, txt] of Object.entries(arquivos)) await writeFile(path.join(dir, nome), txt);
    const idx = new Indice(dir);
    await idx.reindexar();
    await fn(idx);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('comentário YAML no fim da linha não libera nota privada', () => comVault({
  'a.md': '---\nsensibilidade: privada # somente local\n---\nração a',
  'b.md': '---\nnuvem: nao # somente local\n---\nração b',
  'c.md': '---\nsensibilidade: "publica # isto é texto, não comentário"\n---\nração c',
}, async idx => {
  const porNota = Object.fromEntries(idx.buscar('ração').map(t => [t.nota, t.privada]));
  assert.equal(porNota.a, true);
  assert.equal(porNota.b, true);
  assert.equal(porNota.c, false);
}));

test('privadas saem ANTES do limite: nota pública relevante ainda chega à nuvem', () => {
  const arquivos = { 'publica.md': 'ração bezerro' };
  for (let i = 0; i < 8; i++) arquivos[`priv${i}.md`] = `---\nsensibilidade: privada\n---\nração bezerro ração bezerro ${i}`;
  return comVault(arquivos, async idx => {
    const locais = idx.buscar('ração bezerro');
    assert.equal(locais.length, 8, 'limite de 8 ocupado só por privadas');
    assert.ok(locais.every(t => t.privada));
    const fora = buscarParaFora(idx, 'ração bezerro', 'sem-privadas');
    assert.deepEqual(fora.map(t => t.nota), ['publica']);
    assert.equal(buscarParaFora(idx, 'ração bezerro', 'nada').length, 0);
  });
});

test('reserva 9Router nunca recebe privadas, mesmo com principal local', () => comVault({
  'pub.md': 'ração pública', 'priv.md': '---\nsensibilidade: privada\n---\nração privada',
}, async idx => {
  const locais = idx.buscar('ração');
  const externos = buscarParaFora(idx, 'ração', 'sem-privadas');
  const comLocal = planejarContexto({ locais, externos, principalLocal: true });
  assert.equal(comLocal.principal.length, 2, 'Ollama local recebe tudo');
  assert.deepEqual(comLocal.reserva.map(t => t.nota), ['pub'], 'reserva externa só a pública');
  assert.equal(comLocal.retidos, 0);
  const comNuvem = planejarContexto({ locais, externos, principalLocal: false });
  assert.deepEqual(comNuvem.principal.map(t => t.nota), ['pub']);
  assert.equal(comNuvem.retidos, 1);
}));

test('lista YAML sem recuo (tags:\\n- privado) também marca a nota', () => comVault({
  'sem-recuo.md': '---\ntags:\n- fazenda\n- privado\n---\nração sem recuo',
  'pub.md': 'ração pública',
}, async idx => {
  const t = idx.buscar('ração').find(x => x.nota === 'sem-recuo');
  assert.equal(t.privada, true);
  assert.deepEqual(buscarParaFora(idx, 'ração', 'sem-privadas').map(x => x.nota), ['pub']);
}));

test('rede de segurança: qualquer formato YAML com a marca torna a nota privada', () => comVault({
  'colchetes.md': '---\ntags: [\n  privado,\n  cliente\n]\n---\nração colchetes',
  'bloco.md': '---\nmeta:\n  nivel: confidencial\n---\nração bloco',
  'corpo.md': 'ração com tag no corpo #privado',
  'pub.md': '---\ntags: [cliente]\n---\nração pública sem #privacidade',
}, async idx => {
  assert.equal(idx.privadas, 3);
  assert.deepEqual(buscarParaFora(idx, 'ração', 'sem-privadas').map(x => x.nota), ['pub']);
}));

test('marcaPrivadaNoTexto usa palavra inteira, não pedaço', () => {
  assert.equal(marcaPrivadaNoTexto('title: Dados privados e confidenciais'), false);
  assert.equal(marcaPrivadaNoTexto('title: Projeto privado'), true);
  assert.equal(marcaPrivadaNoTexto('nuvem: "não"'), true);
  assert.equal(marcaPrivadaNoTexto('nuvem: sim'), false);
});

test('chave entre aspas e tag após pontuação também protegem', () => comVault({
  'aspas-duplas.md': '---\n"nuvem": false\n---\nração a',
  'aspas-simples.md': "---\n'nuvem': false\n---\nração b",
  'parenteses.md': 'ração c (#privado)',
  'negrito.md': 'ração d **#confidencial**',
  'pub.md': 'ração e veja site.com/#privado e &#privado',
}, async idx => {
  assert.equal(idx.privadas, 4);
  assert.deepEqual(buscarParaFora(idx, 'ração', 'sem-privadas').map(x => x.nota), ['pub']);
}));
