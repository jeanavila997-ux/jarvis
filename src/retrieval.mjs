// Busca simples (BM25) nas notas do vault JARVIS. Sem dependências.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const STOP = new Set(`a o as os um uma uns umas de do da dos das no na nos nas em por para pra com sem e ou que se nao sim ser ter ao aos como mais mas foi sao esta este esse essa isso isto ele ela eles elas eu voce voces me te lhe meu minha seu sua nosso nossa qual quais quando onde porque ja so tambem muito pouco ate sobre entre ha tem vai the and of to in is for on with`.split(/\s+/));

export function normalizar(t) {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function tokens(t) {
  return normalizar(t).split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w));
}

// Padrões que parecem segredo: o arquivo é ignorado na indexação.
const SEGREDO = /(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;

async function listar(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listar(p));
    else if (/\.(md|canvas)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function parseNota(raw, rel) {
  let fm = {}, corpo = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const m = corpo.match(/^---\n([\s\S]*?)\n---\n?/);
  const fmTexto = m ? m[1] : '';
  if (m) {
    corpo = corpo.slice(m[0].length);
    let chave = null;
    for (const l of m[1].split('\n')) {
      const item = l.match(/^\s*-\s*(.*)$/); // item de lista, com ou sem recuo
      if (item && chave) { fm[chave] = `${fm[chave]} ${valorYaml(item[1])}`.trim(); continue; }
      const k = l.match(/^(\w+):\s*(.*)$/);
      if (k) { chave = k[1]; fm[k[1]] = valorYaml(k[2]); }
    }
  }
  const nome = path.basename(rel).replace(/\.(md|canvas)$/i, '');
  const privada = notaPrivada(fm) || marcaPrivadaNoTexto(fmTexto) || TAG_PRIVADA_CORPO.test(normalizar(corpo));
  return { nome, titulo: fm.title || nome, tags: fm.tags || '', status: fm.status || '', corpo, privada };
}

// Valor YAML simples: entre aspas fica como está; sem aspas, "# comentário" no fim é descartado.
function valorYaml(v) {
  const t = String(v).trim();
  const q = t.match(/^(["'])(.*)\1/);
  if (q) return q[2];
  return t.replace(/\s+#.*$/, '').trim();
}

// Sensibilidade (decisão do Jean, não do modelo). Uma nota é PRIVADA se o frontmatter tiver:
//   sensibilidade: privada | confidencial | secreta | sensivel
//   nuvem: nao            (ou false / no)
//   tags com privado, privada ou confidencial
// Notas privadas continuam indexadas (o modelo local e o plano B por regras podem usá-las),
// mas nunca entram num prompt enviado a serviço externo.
export function notaPrivada(fm = {}) {
  const v = x => normalizar(String(x || '')).replace(/[\[\]"',#]/g, ' ').trim();
  if (/^(privad[ao]|confidencial|secret[ao]|sensivel)$/.test(v(fm.sensibilidade))) return true;
  if (/^(nao|false|no|0)$/.test(v(fm.nuvem))) return true;
  return v(fm.tags).split(/\s+/).some(t => /^(privad[ao]|confidencial)$/.test(t));
}

// Rede de segurança que falha para o lado seguro: o leitor de frontmatter acima é simples e não entende
// todo YAML (listas entre colchetes em várias linhas, blocos, etc.). Por isso, além dele, qualquer uma
// destas marcas em QUALQUER lugar do frontmatter torna a nota privada:
//   as palavras privado, privada, confidencial, secreto, secreta, sensivel (palavra inteira)
//   nuvem: nao / false / no
// E no corpo, as tags #privado, #privada ou #confidencial. Um falso positivo só deixa a nota em casa.
const PALAVRA_PRIVADA = /^(privad[ao]|confidencial|secret[ao]|sensivel)$/;
const TAG_PRIVADA_CORPO = /(^|\s)#(privad[ao]|confidencial)(?![\w/-])/m;
export function marcaPrivadaNoTexto(fmTexto = '') {
  const t = normalizar(String(fmTexto));
  if (/(^|\n)\s*nuvem\s*:\s*["']?(nao|false|no|0)\b/.test(t)) return true;
  return t.split(/[^a-z0-9_]+/).some(p => PALAVRA_PRIVADA.test(p));
}

// Política do que pode sair do vault para um modelo externo (env JARVIS_VAULT_NUVEM):
//   sem-privadas (padrão): tudo, menos notas privadas
//   nada: nenhum trecho do vault vai para fora
//   tudo: comportamento antigo (não recomendado)
export const POLITICAS_NUVEM = ['sem-privadas', 'nada', 'tudo'];
export function politicaNuvem(valor) {
  const p = String(valor || '').trim().toLowerCase();
  return POLITICAS_NUVEM.includes(p) ? p : 'sem-privadas';
}
// Busca para um destino EXTERNO, já respeitando a política (filtra antes dos limites).
export function buscarParaFora(indice, consulta, politica = 'sem-privadas') {
  if (politica === 'nada') return [];
  if (politica === 'tudo') return indice.buscar(consulta);
  return trechosParaNuvem(indice.buscar(consulta, { semPrivadas: true }), politica);
}

// Decide que contexto vai para cada destino da rota nuvem.
//   principal: o modelo "nuvem" (pode ser um Ollama local, aí recebe tudo)
//   reserva:   a reserva 9Router é SEMPRE externa, então só recebe o permitido
//   retidos:   quantos trechos da busca local ficaram de fora do principal
export function planejarContexto({ locais, externos, principalLocal }) {
  const chave = t => `${t.arquivo}\u0000${t.texto}`;
  const enviados = new Set(externos.map(chave));
  return {
    principal: principalLocal ? locais : externos,
    reserva: externos,
    retidos: principalLocal ? 0 : locais.filter(t => !enviados.has(chave(t))).length,
  };
}

export function trechosParaNuvem(trechos, politica = 'sem-privadas') {
  if (politica === 'nada') return [];
  if (politica === 'tudo') return trechos;
  return trechos.filter(t => !t.privada);
}

function canvasTexto(raw) {
  try {
    const j = JSON.parse(raw);
    return (j.nodes || []).map(n => n.text || n.label || n.file || '').filter(Boolean).join('\n\n');
  } catch { return ''; }
}

function dividir(corpo, max = 1800) {
  const partes = corpo.split(/\n(?=#{1,3} )/);
  const out = [];
  for (const p of partes) {
    if (p.length <= max) { if (p.trim()) out.push(p.trim()); continue; }
    for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max).trim());
  }
  return out;
}

export class Indice {
  constructor(dir) { this.dir = dir; this.chunks = []; this.ignorados = []; this.notas = 0; this.atualizado = null; }

  async reindexar() {
    const arquivos = await listar(this.dir);
    const chunks = [], ignorados = [];
    let notas = 0, privadas = 0;
    for (const f of arquivos) {
      const rel = path.relative(this.dir, f);
      if ((await stat(f)).size > 512 * 1024) { ignorados.push(rel + ' (grande demais)'); continue; }
      let raw = await readFile(f, 'utf8');
      if (SEGREDO.test(raw)) { ignorados.push(rel + ' (parece conter segredo)'); continue; }
      if (f.endsWith('.canvas')) raw = canvasTexto(raw);
      const n = parseNota(raw, rel);
      notas++;
      if (n.privada) privadas++;
      for (const texto of dividir(n.corpo)) {
        const tk = tokens(`${n.titulo} ${n.titulo} ${n.tags} ${texto}`);
        const tf = new Map();
        for (const t of tk) tf.set(t, (tf.get(t) || 0) + 1);
        chunks.push({ nota: n.nome, titulo: n.titulo, arquivo: rel, texto, tf, len: tk.length, privada: n.privada });
      }
    }
    const df = new Map();
    for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    this.chunks = chunks; this.df = df; this.ignorados = ignorados; this.notas = notas; this.privadas = privadas;
    this.avg = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);
    this.atualizado = new Date().toISOString();
    return { notas, privadas, trechos: chunks.length, ignorados };
  }

  // semPrivadas: tira as notas privadas ANTES de aplicar os limites, para notas públicas relevantes ocuparem a vaga.
  buscar(consulta, { maxTrechos = 8, maxChars = 10000, semPrivadas = false } = {}) {
    const q = [...new Set(tokens(consulta))];
    if (!q.length || !this.chunks.length) return [];
    const N = this.chunks.length, k1 = 1.4, b = 0.75;
    const pont = this.chunks.map(c => {
      let s = 0;
      for (const t of q) {
        const f = c.tf.get(t); if (!f) continue;
        const d = this.df.get(t);
        const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * c.len / this.avg));
      }
      return { c, s };
    }).filter(x => x.s > 0 && !(semPrivadas && x.c.privada)).sort((a, b) => b.s - a.s);
    const sel = []; let total = 0;
    for (const { c, s } of pont) {
      if (sel.length >= maxTrechos || total + c.texto.length > maxChars) continue;
      sel.push({ ...c, score: s }); total += c.texto.length;
    }
    return sel;
  }
}
