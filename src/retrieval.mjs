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
  let fm = {}, corpo = raw.replace(/^\uFEFF/, '');
  const m = corpo.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    corpo = corpo.slice(m[0].length);
    for (const l of m[1].split('\n')) {
      const k = l.match(/^(\w+):\s*(.*)$/);
      if (k) fm[k[1]] = k[2].replace(/^["']|["']$/g, '');
    }
  }
  const nome = path.basename(rel).replace(/\.(md|canvas)$/i, '');
  return { nome, titulo: fm.title || nome, tags: fm.tags || '', status: fm.status || '', corpo };
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
    let notas = 0;
    for (const f of arquivos) {
      const rel = path.relative(this.dir, f);
      if ((await stat(f)).size > 512 * 1024) { ignorados.push(rel + ' (grande demais)'); continue; }
      let raw = await readFile(f, 'utf8');
      if (SEGREDO.test(raw)) { ignorados.push(rel + ' (parece conter segredo)'); continue; }
      if (f.endsWith('.canvas')) raw = canvasTexto(raw);
      const n = parseNota(raw, rel);
      notas++;
      for (const texto of dividir(n.corpo)) {
        const tk = tokens(`${n.titulo} ${n.titulo} ${n.tags} ${texto}`);
        const tf = new Map();
        for (const t of tk) tf.set(t, (tf.get(t) || 0) + 1);
        chunks.push({ nota: n.nome, titulo: n.titulo, arquivo: rel, texto, tf, len: tk.length });
      }
    }
    const df = new Map();
    for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    this.chunks = chunks; this.df = df; this.ignorados = ignorados; this.notas = notas;
    this.avg = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);
    this.atualizado = new Date().toISOString();
    return { notas, trechos: chunks.length, ignorados };
  }

  buscar(consulta, { maxTrechos = 8, maxChars = 10000 } = {}) {
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
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const sel = []; let total = 0;
    for (const { c, s } of pont) {
      if (sel.length >= maxTrechos || total + c.texto.length > maxChars) continue;
      sel.push({ ...c, score: s }); total += c.texto.length;
    }
    return sel;
  }
}
