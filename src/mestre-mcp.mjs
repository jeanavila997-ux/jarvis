// Cliente do MCP do Mestre do PC (launcher do PC do Jean, http://127.0.0.1:7777/mcp).
// DESLIGADO por padrão (MESTRE_MCP=1 liga). Na VPS o MCP chega por túnel SSH reverso
// (PC 127.0.0.1:7777 -> VPS 127.0.0.1:17777) e o container fala por um Unix socket
// (socat, mesmo padrão do Hermes: unix:///app/run/mestre.sock). No PC, direto no launcher.
// Níveis (docs/PERMISSOES.md), decididos SÓ por este arquivo, nunca pelo modelo:
//   0 · status / operações / memórias (leitura)     -> executa e responde
//   2 · save_memory / run_operation / optimize_ram_and_temp / ask_grok -> só via Confirmacoes
//   3 · run_operation destrutivo (apagar, formatar, desligar proteção...) -> recusado sempre
// Ferramenta fora da lista = recusada (fail-closed). Nunca loga o token.
import { fetchUrl } from './http-unix.mjs';
import { mcpRpc } from './nvidia-mcp.mjs';
import { NIVEL } from './confirmacoes.mjs';

// Nomes de leitura: aceitamos as variações prováveis; confirme com tools/list quando o túnel existir
// e ajuste MESTRE_MCP_EXTRA_LEITURA (lista separada por vírgula) se o nome real for outro.
export const FERRAMENTAS_LEITURA = Object.freeze([
  'status', 'get_status', 'mestre_status', 'system_status',
  'operations', 'list_operations', 'get_operations', 'listar_operacoes',
  'memories', 'list_memories', 'get_memories', 'search_memories', 'listar_memorias',
]);
export const FERRAMENTAS_NIVEL2 = Object.freeze(['save_memory', 'run_operation', 'optimize_ram_and_temp', 'ask_grok']);

// Operações que contam como destrutivas (nível 3) quando pedidas via run_operation.
const DESTRUTIVO = /(\b|_)(apag\w*|delet\w*|exclu\w*|remov\w*|destru\w*|format\w*|wipe|erase|purge|uninstall|desinstal\w*|rm\s+-rf|rmdir|del\s+\/[sq]|diskpart|cipher\s+\/w|vssadmin|shadow\w*|bcdedit|reg\s+delete|reset\w*|restaur\w*_?fabrica|factory|backup\w*)(\b|_)|(\b|_)(deslig\w*|desativ\w*|desabilit\w*|disable\w*|turn_?off|stop)(\b|_).{0,30}(firewall|defender|antiv\w*|uac|smartscreen|seguranc\w*|security|update\w*|bitlocker)|(\b|_)(firewall|defender|antiv\w*|uac|bitlocker)(\b|_).{0,20}(off|disable\w*|deslig\w*|desativ\w*)|(senha|password|token|segredo|secret|credenc\w*|chave|api_?key)/i;
// Limpeza de temporários/cache é a mesma coisa que optimize_ram_and_temp: nível 2, não 3.
const SO_TEMP = /^(limpar|clear|clean|esvaziar)[_\s-]?(temp\w*|tmp|cache\w*|lixeira_?temp)$/i;

function textoArgs(args) {
  try { return JSON.stringify(args ?? {}); } catch { return ''; }
}

export function nivelFerramenta(nome, args = {}, { extraLeitura = [] } = {}) {
  const n = String(nome || '').trim();
  if (FERRAMENTAS_LEITURA.includes(n) || extraLeitura.includes(n)) return { nivel: NIVEL.LIVRE, motivo: 'leitura' };
  if (!FERRAMENTAS_NIVEL2.includes(n)) return { nivel: NIVEL.PROIBIDO, motivo: `ferramenta fora da allowlist (${n || 'vazia'})` };
  if (n === 'run_operation') {
    const op = String(args?.operation ?? args?.operacao ?? args?.name ?? args?.id ?? '').trim();
    if (!op) return { nivel: NIVEL.PROIBIDO, motivo: 'run_operation sem operação explícita' };
    if (SO_TEMP.test(op)) return { nivel: NIVEL.SIM, motivo: `operação ${op}` };
    if (DESTRUTIVO.test(op) || DESTRUTIVO.test(textoArgs(args))) return { nivel: NIVEL.PROIBIDO, motivo: `operação destrutiva (${op})` };
    return { nivel: NIVEL.SIM, motivo: `operação ${op}` };
  }
  return { nivel: NIVEL.SIM, motivo: n };
}

export function rotuloAcao(nome, args = {}) {
  const resumo = textoArgs(args);
  return `Mestre do PC · ${nome}${resumo && resumo !== '{}' ? ' ' + resumo.slice(0, 300) : ''}`;
}

export function criarClienteMestre({
  ligada = false,
  url = '',            // unix:///app/run/mestre.sock  ou  http://host.docker.internal:7777
  caminho = '/mcp',
  token = '',
  extraLeitura = [],
  timeoutMs = 20000,
  cacheMs = 30000,
  agora = () => Date.now(),
  fetchFn = null,      // testes: (path, opts) => Response
} = {}) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  const ativa = Boolean(ligada && base);
  const extras = (Array.isArray(extraLeitura) ? extraLeitura : String(extraLeitura || '').split(',')).map(s => s.trim()).filter(Boolean);
  const comAuth = (opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (token) { headers.authorization = `Bearer ${token}`; headers['x-mcp-token'] = token; }
    return { ...opts, headers };
  };
  const enviar = (p, opts) => (fetchFn ? fetchFn(p, comAuth(opts)) : fetchUrl(base, p, comAuth(opts)));
  // Sessão MCP (Streamable HTTP). Tolera servidor sem mcp-session-id (stateless).
  let session = null, pronta = null;
  async function abrir() {
    const init = await mcpRpc({ fetchFn: enviar, upstream: caminho, timeoutMs, body: { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'jarvis-mestre', version: '0.2.0' } } } });
    if (init.status === 401 || init.status === 403) throw new Error(`mestre-mcp: acesso recusado (${init.status}); confira MESTRE_MCP_TOKEN`);
    if (init.status >= 300 || init.json?.error) throw new Error(`mestre-mcp: initialize falhou (HTTP ${init.status})`);
    session = init.session || null;
    await mcpRpc({ fetchFn: enviar, upstream: caminho, session, timeoutMs, body: { jsonrpc: '2.0', method: 'notifications/initialized' } }).catch(() => {});
  }
  const garantir = () => (pronta ||= abrir().catch(e => { pronta = null; session = null; throw e; }));
  const sessao = {
    async chamar(body) {
      await garantir();
      let r = await mcpRpc({ fetchFn: enviar, upstream: caminho, session, timeoutMs, body });
      if (session && (r.status === 404 || r.status === 400)) { pronta = null; session = null; await garantir(); r = await mcpRpc({ fetchFn: enviar, upstream: caminho, session, timeoutMs, body }); }
      return r;
    },
    async fechar() { if (session) { try { await mcpRpc({ fetchFn: enviar, upstream: caminho, session, method: 'DELETE', timeoutMs: 5000, body: '' }); } catch {} } session = null; pronta = null; },
  };
  let saudeCache = { ate: 0, valor: null };
  let rpcId = 10;

  async function rpc(method, params) {
    if (!ativa) throw new Error('mestre-mcp: desligado (MESTRE_MCP=0)');
    const r = await sessao.chamar({ jsonrpc: '2.0', id: ++rpcId, method, params });
    if (r.status === 401 || r.status === 403) throw new Error(`mestre-mcp: acesso recusado (${r.status}); confira MESTRE_MCP_TOKEN`);
    if (r.status >= 300) throw new Error(`mestre-mcp: HTTP ${r.status}`);
    if (r.json?.error) throw new Error(`mestre-mcp: ${r.json.error.message || 'erro'}`);
    return r.json?.result;
  }

  async function listar() {
    const res = await rpc('tools/list', {});
    return (res?.tools || []).map(t => ({ nome: t.name, nivel: nivelFerramenta(t.name, {}, { extraLeitura: extras }).nivel }));
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado' };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    let valor;
    try { const fs = await listar(); valor = { ok: true, motivo: 'ok', ferramentas: fs }; }
    catch (e) { valor = { ok: false, motivo: /ECONNREFUSED|ENOENT|tempo|abort/i.test(e.message) ? 'PC desligado ou túnel fora do ar' : e.message }; }
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  // Chamada crua. NÃO use direto para nível 2: passe por prepararAcao/Confirmacoes.
  async function chamarBruto(nome, args = {}) {
    const res = await rpc('tools/call', { name: nome, arguments: args || {} });
    const txt = (res?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    return { texto: txt || JSON.stringify(res ?? {}).slice(0, 2000), erro: Boolean(res?.isError) };
  }

  // Nível 0: executa direto. Nível 2/3: recusa aqui (precisa de prepararAcao).
  async function ler(nome, args = {}) {
    const { nivel, motivo } = nivelFerramenta(nome, args, { extraLeitura: extras });
    if (nivel !== NIVEL.LIVRE) throw new Error(`mestre-mcp: ${nome} é nível ${nivel} (${motivo}); leitura direta recusada`);
    return chamarBruto(nome, args);
  }

  // Ponto único para ações: decide o nível e, se for 2, cria a confirmação (botão, 10 min, uso único).
  function prepararAcao({ confirmacoes, nome, args = {}, canal = 'telegram', chatId, auditar = () => {} }) {
    const { nivel, motivo } = nivelFerramenta(nome, args, { extraLeitura: extras });
    const rotulo = rotuloAcao(nome, args);
    if (nivel === NIVEL.PROIBIDO) {
      auditar({ canal, nivel, acao: 'mestre-mcp', alvo: nome, motivo, resultado: 'recusado-nivel3' });
      return { nivel, recusado: true, motivo: `Nível 3 (${motivo}): proibido mesmo com "sim". Só o Jean faz, no próprio PC.` };
    }
    if (nivel === NIVEL.LIVRE) return { nivel, executarAgora: () => ler(nome, args) };
    if (!confirmacoes) return { nivel, recusado: true, motivo: 'Nível 2 precisa do botão de confirmação (Telegram/web).' };
    const c = confirmacoes.criar({ nivel, acao: rotulo, alvo: 'PC do Jean (Mestre do PC)', canal, chatId,
      executar: async () => { const r = await chamarBruto(nome, args); if (r.erro) throw new Error(r.texto.slice(0, 300)); return `Feito: ${r.texto.slice(0, 500)}`; } });
    return { nivel, rotulo, ...c };
  }

  return { ativa, saudavel, listar, ler, prepararAcao, fechar: () => sessao.fechar() };
}

export function textoMestreStatus(s) {
  if (!s) return 'Mestre do PC: sem dados.';
  if (!s.ok) return `Mestre do PC: ${s.motivo === 'desligado' ? 'desligado (MESTRE_MCP=0)' : `indisponível (${s.motivo})`}.`;
  const por = n => s.ferramentas.filter(f => f.nivel === n).map(f => f.nome);
  return `Mestre do PC no ar. Leitura (nível 0): ${por(0).join(', ') || '—'}. Com "sim" (nível 2): ${por(2).join(', ') || '—'}. Bloqueadas: ${por(3).join(', ') || 'nenhuma'}.`;
}
