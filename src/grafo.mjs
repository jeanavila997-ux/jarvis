// Etapa 3 — grafo do vault no chat: nós = notas tocadas, arcos = wikilinks + co-citação no mesmo turno.
// Tudo serializável (vai para data/conversas/*.json). Nada de dependência.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const limpaNome = s => {
  const n = String(s || '').trim();
  if (!n || n.startsWith('..') || n.includes('/') || n.includes('\\')) return null;
  return n;
};

export function extrairWikilinks(texto) {
  const out = new Set();
  for (const m of String(texto || '').matchAll(/\[\[([^\[\]]+)\]\]/g)) {
    const bruto = m[1].split('|')[0];
    const n = limpaNome(bruto);
    if (n) out.add(n);
  }
  return [...out];
}

// Grafo como DADO PURO (serializa junto com a conversa): { nos: [{id,peso}], arcos: [{de,para,peso}] }.
export function criarGrafo() { return { nos: [], arcos: [] }; }

const somarNo = (g, id) => {
  const n = g.nos.find(x => x.id === id);
  if (n) n.peso += 1; else g.nos.push({ id, peso: 1 });
};
const somarArco = (g, x, y, peso) => {
  const [de, para] = x <= y ? [x, y] : [y, x];
  const a = g.arcos.find(e => e.de === de && e.para === para);
  if (a) a.peso += peso; else g.arcos.push({ de, para, peso });
};

export function tocarTurno(g, nomes, textoTrechos = '') {
  const fontes = [...new Set((nomes || []).map(n => limpaNome(n)).filter(n => n))];
  fontes.forEach(n => somarNo(g, n));
  for (let i = 0; i < fontes.length; i++)
    for (let j = i + 1; j < fontes.length; j++) somarArco(g, fontes[i], fontes[j], 1);
  const ocorrencias = new Map();
  for (const m of String(textoTrechos || '').matchAll(/\[\[([^\[\]]+)\]\]/g)) {
    const dest = limpaNome(m[1].split('|')[0]);
    if (dest) ocorrencias.set(dest, (ocorrencias.get(dest) || 0) + 1);
  }
  for (const [dest, n] of ocorrencias) {
    somarNo(g, dest);
    for (const f of fontes) if (f !== dest) somarArco(g, f, dest, 2 * n);
  }
  return g;
}

// Localiza <nome>.md no vault (só basename, nada de caminho). null = não achou ou nome perigoso.
export async function acharNota(vaultDir, nome) {
  const n = limpaNome(nome);
  if (!n) return null;
  let entradas;
  try { entradas = await readdir(vaultDir, { recursive: true }); } catch { return null; }
  const alvo = `${n}.md`.toLowerCase();
  const achado = entradas.find(e => e.toLowerCase().endsWith(alvo) && !e.startsWith('..') && !path.isAbsolute(e));
  if (!achado) return null;
  return path.join(vaultDir, achado);
}

export async function lerNota(vaultDir, nome) {
  const arquivo = await acharNota(vaultDir, nome);
  if (!arquivo) return null;
  try { return { nome, conteudo: await readFile(arquivo, 'utf8') }; } catch { return null; }
}
