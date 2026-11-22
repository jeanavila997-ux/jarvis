// Classificador local (modelo pequeno no Ollama da VPS). Saída em JSON rígido, validada aqui.
// Só decide DIFICULDADE (nota 1-5) e TIPO, para escolher a rota. Nunca decide permissão.
import { chatOllama } from './llm.mjs';

export const TIPOS = ['saudacao', 'pergunta_simples', 'vault', 'calculo', 'codigo', 'planejamento', 'pesquisa', 'acao', 'outro'];
const FORMATO = {
  type: 'object',
  properties: { nota: { type: 'integer', minimum: 1, maximum: 5 }, tipo: { type: 'string', enum: TIPOS } },
  required: ['nota', 'tipo'],
};
const SISTEMA = `Você classifica pedidos enviados a um assistente pessoal. NÃO responda ao pedido. Devolva só JSON.
nota (1-5): 1=saudação/conversa trivial; 2=pergunta simples e curta, resposta em 1-3 frases, sem raciocínio; 3=precisa de explicação, notas do projeto, conta ou comparação; 4=várias etapas, código, planejamento ou análise longa; 5=pesquisa externa atualizada ou ferramentas externas.
tipo: ${TIPOS.join(' | ')}`;

export function validar(bruto) {
  let j;
  try { j = typeof bruto === 'string' ? JSON.parse(bruto) : bruto; } catch { throw new Error('classificador devolveu JSON inválido'); }
  const nota = Number(j?.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw new Error('classificador devolveu nota fora de 1-5');
  if (!TIPOS.includes(j?.tipo)) throw new Error('classificador devolveu tipo desconhecido');
  return { nota, tipo: j.tipo };
}

export async function classificar(texto, { url, model, timeoutMs = 20000, keepAlive = '30m', chat = chatOllama } = {}) {
  const t0 = Date.now();
  const r = await chat({
    url, model, stream: false, timeoutMs, keepAlive, format: FORMATO, nome: 'Ollama local (classificador)',
    options: { temperature: 0, num_predict: 40, num_ctx: 4096 /* igual ao da resposta local: evita o Ollama recarregar o modelo */ },
    messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: String(texto).slice(0, 1500) }],
  });
  return { ...validar(r.resposta), ms: Date.now() - t0, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
}
