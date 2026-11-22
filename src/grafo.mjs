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

export function criarGrafo() {
  const nos = new Map();      // id -> peso
  const arcos = new Map();    // 'a\u0001b' (ordenado) -> peso
  const arco = (x, y, peso) => {
    const par = x <= y ? [x, y] : [y, x];
    const k = par.join('\u0001');
    arcos.set(k, (arcos.get(k) || 0) + peso);
  };

  function registrarTurno(nomes, textoTrechos = '') {
    const fontes = (nomes || []).map(n => limpaNome(n)).filter(n => n && nos.set(n, (nos.get(n) || 0) + 1));
    // co-citação: todas as fontes do turno se conectam (peso 1)
    for (let i = 0; i < fontes.length; i++)
      for (let j = i + 1; j < fontes.length; j++) arco(fontes[i], fontes[j], 1);
    // wikilinks dos trechos: vizinho entra uma vez; arco com peso 2 por OCORRÊNCIA
    const ocorrencias = new Map();
    for (const m of String(textoTrechos || '').matchAll(/\[\[([^\[\]]+)\]\]/g)) {
      const dest = limpaNome(m[1].split('|')[0]);
      if (dest) ocorrencias.set(dest, (ocorrencias.get(dest) || 0) + 1);
    }
    for (const [dest, n] of ocorrencias) {
      nos.set(dest, (nos.get(dest) || 0) + 1);
      for (const f of fontes) if (f !== dest) arco(f, dest, 2 * n);
    }
  }

  function resumo() {
    return {
      nos: [...nos.entries()].map(([id, peso]) => ({ id, peso })),
      arcos: [...arcos.entries()].map(([k, peso]) => { const [de, para] = k.split('\u0001'); return { de, para, peso }; }),
    };
  }

  return { registrarTurno, resumo };
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
