// Testes da Etapa 1 (sem rede): node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { nivelPorRegras } from '../src/permissoes.mjs';
import { qualRegra, responderPorRegras } from '../src/regras.mjs';
import { criarRoteador } from '../src/roteador.mjs';
import { validar, classificar } from '../src/classificador.mjs';
import { registrarUso, resumoUso } from '../src/uso.mjs';

test('Guarda: níveis por regra fixa', () => {
  const casos = [
    ['oi jarvis, bom dia', 0], ['o que é o hermes?', 0], ['qual a margem do sal mineral?', 0],
    ['me lembra de ligar pro cliente amanhã', 1], ['anota essa ideia', 1],
    ['manda uma mensagem pro cliente João', 2], ['reinicia o container do n8n', 2], ['agenda uma reunião sexta', 2],
    ['faz git push no repo', 2], ['compra o plano pro da api', 2],
    ['apaga os backups antigos', 3], ['me mostra a senha do hostinger', 3], ['roda git reset --hard', 3],
    ['desliga o firewall', 3], ['abre a porta 8081', 3], ['ativa o fallback pago', 3],
    ['receita de mandioca', 0], ['dicas para container docker', 0], ['abre essa página', 0],
  ];
  for (const [t, n] of casos) assert.equal(nivelPorRegras(t).nivel, n, t);
});

test('Regras fixas sem IA', async () => {
  for (const t of ['status', '/status', 'Status?', 'ajuda', '/ajuda', 'quais os comandos?', 'custo', '/custo', 'permissões']) assert.ok(qualRegra(t), t);
  for (const t of ['qual o status do hermes na vps?', 'oi', 'me ajuda com uma planilha']) assert.equal(qualRegra(t), null, t);
  const ctx = { status: () => ({ uptimeS: 3700, modelo: 'glm', local: false, localModelo: 'x', notas: 1, trechos: 2, indexado: null }), resumo: async d => ({ dias: d, total: 0, rotas: {} }) };
  const r = await responderPorRegras('status', ctx);
  assert.match(r.texto, /no ar há 1h01min/);
});

test('Classificador: JSON rígido', () => {
  assert.deepEqual(validar('{"nota":2,"tipo":"saudacao"}'), { nota: 2, tipo: 'saudacao' });
  assert.throws(() => validar('{"nota":7,"tipo":"saudacao"}'));
  assert.throws(() => validar('{"nota":2,"tipo":"inventado"}'));
  assert.throws(() => validar('não é json'));
  assert.throws(() => validar('{"nota":"2.5","tipo":"vault"}'));
});

const classifFixo = (nota, tipo) => async () => ({ nota, tipo, ms: 5 });
test('Roteador: notas, tipos, Guarda e plano B', async () => {
  const g0 = { nivel: 0, motivos: [] };
  let r = criarRoteador({ localUrl: '', localModel: 'm', classificar: classifFixo(1, 'saudacao') });
  assert.equal((await r.decidir('oi', g0)).motivo, 'local-desligado');
  r = criarRoteador({ localUrl: 'http://x', localModel: 'm', classificar: classifFixo(1, 'saudacao') });
  assert.equal((await r.decidir('oi', g0)).rota, 'local');
  assert.equal((await r.decidir('oi', { nivel: 2, motivos: ['x'] })).rota, 'nuvem'); // Guarda vence o classificador
  assert.equal((await r.decidir('qual o preço do boi gordo hoje?', g0)).motivo, 'pede-dado-atual');
  r = criarRoteador({ localUrl: 'http://x', localModel: 'm', classificar: classifFixo(2, 'pergunta_simples') });
  assert.equal((await r.decidir('o que é o hermes?', g0)).rota, 'nuvem'); // conteúdo: local 3B inventa
  r = criarRoteador({ localUrl: 'http://x', localModel: 'm', classificar: classifFixo(3, 'vault') });
  assert.equal((await r.decidir('explica', g0)).rota, 'nuvem');
  r = criarRoteador({ localUrl: 'http://x', localModel: 'm', classificar: classifFixo(2, 'codigo') });
  assert.equal((await r.decidir('x', g0)).motivo, 'tipo-codigo');
  r = criarRoteador({ localUrl: 'http://x', localModel: 'm', classificar: async () => { throw new Error('timeout'); } });
  const d = await r.decidir('oi', g0);
  assert.equal(d.rota, 'nuvem'); assert.equal(d.motivo, 'plano-b-classificador-falhou');
});

test('Classificador usa formato JSON e temperatura 0', async () => {
  let pedido;
  const chat = async p => { pedido = p; return { resposta: '{"nota":1,"tipo":"saudacao"}', tokensIn: 10, tokensOut: 5 }; };
  const c = await classificar('oi', { url: 'http://x', model: 'm', chat });
  assert.equal(c.nota, 1); assert.equal(pedido.options.temperature, 0); assert.equal(pedido.format.type, 'object'); assert.equal(pedido.stream, false);
});

test('Registro de uso JSONL + resumo', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jarvis-'));
  await registrarUso(dir, { canal: 'web', rota: 'regras', modelo: 'regras', ms: 2 });
  await registrarUso(dir, { canal: 'web', rota: 'nuvem', modelo: 'glm', ms: 1000, tokens_in: 100, tokens_out: 50 });
  await registrarUso(dir, { canal: 'telegram', rota: 'nuvem', modelo: 'glm', motivo: 'plano-b-local-falhou', ms: 1000, tokens_in: 10, tokens_out: 5 });
  const linhas = (await readFile(path.join(dir, 'uso.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(linhas.length, 3); assert.equal(linhas[1].cobranca, 'assinatura-ollama-cloud'); assert.match(linhas[0].ts, /-05:00$/);
  const s = await resumoUso(dir, 1);
  assert.equal(s.total, 3); assert.equal(s.rotas.nuvem.tokens, 165); assert.equal(s.rotas.nuvem.planoB, 1);
});
