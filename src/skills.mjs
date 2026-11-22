// Skills do JARVIS — formato Agent Skills (SKILL.md com frontmatter mínimo name/description).
// Instalação pelo hospedeiro (Hermes) em data/skills/<nome>/SKILL.md; o JARVIS só LÊ texto.
// Skills NUNCA executam scripts: o corpo é injeção instrucional na rota nuvem, só na conversa que ativou.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const NOME_OK = /^[\w.-]{1,64}$/;
const CACHE_MS = 15000;

export function parserFrontmatter(raw) {
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const p = linha.match(/^([\w-]+):\s*(.*)$/);
    if (p) meta[p[1]] = p[2].trim();
  }
  return { meta, corpo: m[2] };
}

export function criarSkills({ dataDir, maxCorpo = 12000, maxListaLinha = 1500, log = () => {} }) {
  const dir = path.join(dataDir, 'skills');
  let cache = { lido: 0, mapa: new Map() };

  async function carregar(forcar = false) {
    if (!forcar && Date.now() - cache.lido < CACHE_MS) return cache.mapa;
    const mapa = new Map();
    for (const nome of await readdir(dir).catch(() => [])) {
      if (!NOME_OK.test(nome)) continue;
      let bruto; try { bruto = await readFile(path.join(dir, nome, 'SKILL.md'), 'utf8'); } catch { continue; }
      const p = parserFrontmatter(bruto);
      if (!p || !p.meta.name || !p.meta.description) { log(`skill ignorada (frontmatter incompleto): ${nome}`); continue; }
      if (p.meta.name !== nome) { log(`skill ignorada (nome diferente da pasta): ${nome}`); continue; }
      mapa.set(nome, { nome, descricao: p.meta.description.slice(0, 200), corpo: p.corpo.trim().slice(0, maxCorpo), chars: p.corpo.trim().length });
    }
    cache = { lido: Date.now(), mapa };
    return mapa;
  }

  return {
    async listar() { return [...(await carregar(true)).values()].map(({ nome, descricao, chars }) => ({ nome, descricao, chars })); },
    async listarLinha() {
      const m = await carregar();
      if (!m.size) return '';
      const nomes = [...m.keys()].slice(0, 120).join(', ');
      const linha = `Skills instaladas (texto completo entra só quando o Jean ativa com /skill <nome>; nunca executam comandos; /skills lista com descrição): ${nomes}`;
      return linha.slice(0, maxListaLinha);
    },
    async corpos(nomes = []) {
      const m = await carregar();
      const validos = (nomes || []).filter(n => m.has(n));
      return validos.map(n => `## Skill ativa: ${n}\n${m.get(n).corpo}`);
    },
  };
}
