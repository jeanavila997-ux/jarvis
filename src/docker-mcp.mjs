// Cliente do Docker MCP Gateway (GitHub Official via host.docker.internal).
// DESLIGADO por padrão (DOCKER_MCP=1 liga). Só fala com o gateway no loopback do host.
// Ferramentas de LEITURA: nível 0. Escrita comum: nível 2 (precisa de "sim").
// Escrita destrutiva: nível 3 (proibida, mesmo com "sim") — alinhado a docs/PERMISSOES.md
// e a confirmacoes.mjs (nível 3 nunca é confirmável). Nunca loga o token.
import { criarSessaoUpstream } from './nvidia-mcp.mjs';

export const FERRAMENTAS_LEITURA = Object.freeze([
  'get_me',
  'get_file_contents',
  'get_commit',
  'get_tag',
  'get_team_members',
  'get_teams',
  'get_latest_release',
  'get_release_by_tag',
  'get_label',
  'issue_read',
  'get_issue',
  'list_branches',
  'list_commits',
  'list_issue_types',
  'list_issues',
  'list_pull_requests',
  'list_releases',
  'list_tags',
  'pull_request_read',
  'search_code',
  'search_issues',
  'search_pull_requests',
  'search_repositories',
  'search_users',
]);

export const FERRAMENTAS_ESCRITA = Object.freeze([
  'add_comment_to_pending_review',
  'add_issue_comment',
  'assign_copilot_to_issue',
  'create_branch',
  'create_or_update_file',
  'create_pull_request',
  'create_repository',
  'fork_repository',
  'issue_write',
  'pull_request_review_write',
  'push_files',
  'request_copilot_review',
  'sub_issue_write',
  'update_pull_request',
  'update_pull_request_branch',
]);

export const FERRAMENTAS_DESTRUTIVAS = Object.freeze([
  'delete_file',
  'merge_pull_request',
]);

const LEITURA = new Set(FERRAMENTAS_LEITURA);
const ESCRITA = new Set(FERRAMENTAS_ESCRITA);
const DESTRUTIVA = new Set(FERRAMENTAS_DESTRUTIVAS);

function prefixosConhecidos(nome) {
  const n = String(nome || '');
  for (const p of ['github-official_', 'github-official.', 'github_', 'github.']) {
    if (n.startsWith(p)) return n.slice(p.length);
  }
  return n;
}

export function nomeCanonico(nome) {
  return prefixosConhecidos(nome);
}

export function classificarFerramentaGithub(nome, meta) {
  const n = nomeCanonico(nome);
  if (DESTRUTIVA.has(n)) return 'DESTRUTIVA';
  const hint = meta?.annotations?.readOnlyHint;
  if (hint === true) return LEITURA.has(n) || !ESCRITA.has(n) ? 'LEITURA' : 'ESCRITA';
  if (hint === false) return DESTRUTIVA.has(n) ? 'DESTRUTIVA' : 'ESCRITA';
  if (LEITURA.has(n)) return 'LEITURA';
  if (ESCRITA.has(n)) return 'ESCRITA';
  if (DESTRUTIVA.has(n)) return 'DESTRUTIVA';
  return 'DESCONHECIDA';
}

// Fail-closed: ferramenta nova ou sem allowlist não passa como leitura.
export function podeChamarLeitura(nome, meta) {
  const n = nomeCanonico(nome);
  if (!LEITURA.has(n)) return false;
  if (meta && meta.annotations && meta.annotations.readOnlyHint === false) return false;
  return classificarFerramentaGithub(n, meta) === 'LEITURA';
}

export function podeChamarEscrita(nome, meta, { confirmado = false } = {}) {
  const n = nomeCanonico(nome);
  const classe = classificarFerramentaGithub(n, meta);
  if (classe !== 'ESCRITA') return false;
  if (meta && meta.annotations && meta.annotations.readOnlyHint === true) return false;
  return confirmado === true;
}

export function criarClienteDockerMcp({
  ligada = false,
  url = '',
  token = '',
  timeoutMs = 20000,
  cacheMs = 30000,
  agora = () => Date.now(),
  fetchFn = fetch,
} = {}) {
  const base = String(url || '').trim();
  const tok = String(token || '').trim();
  const ativa = Boolean(ligada && base && tok);
  const headersExtra = tok ? { authorization: `Bearer ${tok}` } : {};
  try {
    const u = new URL(base);
    if (u.hostname === 'host.docker.internal') headersExtra.Host = `127.0.0.1${u.port ? ':' + u.port : ''}`;
  } catch {}
  const sessao = ativa ? criarSessaoUpstream({
    fetchFn, upstream: base, timeoutMs, headersExtra,
    clientInfo: { name: 'jarvis-local-docker-mcp', version: '0.2.0' },
    nomeErro: 'docker-mcp-gateway',
    exigirSessao: false,
  }) : null;
  let saudeCache = { ate: 0, valor: null };
  let idRpc = 10;

  async function ferramentasAoVivo() {
    const r = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
    const tools = r.json?.result?.tools || [];
    return tools.map(t => {
      const nome = nomeCanonico(t.name);
      const classe = classificarFerramentaGithub(nome, t);
      return { name: nome, originalName: t.name, description: t.description, classe, inputSchema: t.inputSchema };
    }).filter(t => t.classe === 'LEITURA' || t.classe === 'ESCRITA' || t.classe === 'DESTRUTIVA');
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado' };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    let valor = { ok: false, motivo: 'indisponivel' };
    try {
      const ferramentas = await ferramentasAoVivo();
      const leitura = ferramentas.filter(f => f.classe === 'LEITURA').map(f => f.name);
      valor = { ok: true, motivo: 'ok', ferramentas: leitura, total: ferramentas.length };
    } catch { valor = { ok: false, motivo: 'indisponivel' }; }
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  async function listar() {
    if (!ativa) throw new Error('docker-mcp: desligado');
    return ferramentasAoVivo();
  }

  async function chamar(nome, argumentos = {}, { confirmado = false } = {}) {
    if (!ativa) throw new Error('docker-mcp: desligado');
    const n = nomeCanonico(nome);
    const classe = classificarFerramentaGithub(n);
    if (classe === 'DESTRUTIVA' || classe === 'DESCONHECIDA') {
      throw new Error(`docker-mcp: '${n}' é ${classe === 'DESTRUTIVA' ? 'nível 3 (proibida)' : 'desconhecida'} e o cliente recusou`);
    }
    if (classe === 'ESCRITA' && !confirmado) {
      throw new Error(`docker-mcp: '${n}' é escrita (nível 2) e exige confirmação`);
    }
    if (classe === 'LEITURA' && !LEITURA.has(n)) {
      throw new Error(`docker-mcp: '${n}' recusada pela allowlist de leitura`);
    }
    const lista = await sessao.chamar({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list', params: {} });
    const meta = (lista.json?.result?.tools || []).find(t => nomeCanonico(t.name) === n);
    if (!meta) throw new Error(`docker-mcp: ferramenta '${n}' não está no gateway`);
    if (classe === 'LEITURA' && !podeChamarLeitura(n, meta)) {
      throw new Error(`docker-mcp: '${n}' recusada pela allowlist`);
    }
    if (classe === 'ESCRITA' && !podeChamarEscrita(n, meta, { confirmado })) {
      throw new Error(`docker-mcp: '${n}' recusada (escrita sem confirmação)`);
    }
    const r = await sessao.chamar({
      jsonrpc: '2.0', id: ++idRpc, method: 'tools/call',
      params: { name: meta.name, arguments: argumentos || {} },
    });
    // meta.originalName may be undefined — use the live tool name
    if (r.json?.error) throw new Error(`docker-mcp: ${r.json.error.message || r.json.error}`);
    return { name: n, result: r.json?.result ?? null };
  }

  return {
    ativa, saudavel, listar, chamar, fechar: () => sessao?.fechar(),
    leitura: FERRAMENTAS_LEITURA, escrita: FERRAMENTAS_ESCRITA, destrutiva: FERRAMENTAS_DESTRUTIVAS,
  };
}
