// Respostas fixas, sem IA e sem custo, para status/ajuda/comandos/custo/permissões.
// Só casa mensagens curtas e explícitas (ex.: "status", "/ajuda", "quais os comandos?").
import { normalizar } from './retrieval.mjs';
import { textoResumo } from './uso.mjs';

export const AJUDA = `Comandos (respondidos por regra, sem IA):
/status — saúde do JARVIS e rotas
/custo — uso e custo por rota (hoje e 7 dias)
/permissoes — os 4 níveis de permissão
/hermes — status do Hermes (leitura); tarefas se a chave estiver configurada
/nvidia — status da GPU via nvidia-app (só leitura)
/ajuda — esta lista
No Telegram também: /nova (conversa nova), /briefing, /revisao, /reindexar, /parar (cancela confirmações e pausa rotinas), /retomar, /testesim.
Ações do Hermes que mudam algo (pausar, retomar, rodar, apagar, criar) são nível 2 e pedem "sim" no Telegram.`;

export const TEXTO_PERMISSOES = `Níveis de permissão (docs/PERMISSOES.md, aplicados por regra fixa, não pela IA):
0 · Livre — responder, ler, buscar no vault.
1 · Faz e avisa — só coisas do próprio JARVIS (diário, rascunho, lembrete), sempre auditado.
2 · Precisa de "sim" — enviar mensagem, agenda, editar arquivo, reiniciar serviço, git, gastar. Botão de confirmação, 10 min, uso único.
3 · Proibido — apagar dados/backups, force-push, expor segredo, abrir porta, fallback pago. Só o Jean faz.
Ferramentas desta versão: ler vault, status do Hermes (e listar tarefas com chave), leitura do nvidia-app. Mutações do Hermes são nível 2 e só rodam depois do "sim" no Telegram.`;

const PADROES = [
  ['status', /^\/?(status|saude|como\s+voce\s+esta\s+de\s+saude|voce\s+esta\s+(no\s+ar|online))[\s?!.]*$/],
  ['ajuda', /^\/?(ajuda|help|start|comandos|menu|quais\s+(sao\s+)?(os\s+)?(seus\s+)?comandos|o\s+que\s+voce\s+(sabe\s+)?faz(er)?)[\s?!.]*$/],
  ['custo', /^\/?(custo|custos|uso|gasto|gastos|quanto\s+(voce\s+)?(gastou|gastei|custou))[\s?!.]*$/],
  ['permissoes', /^\/?(permissoes|permissao|niveis(\s+de\s+permissao)?)[\s?!.]*$/],
  ['hermes', /^\/?hermes[\s?!.]*$/],
  ['nvidia', /^\/?(nvidia|gpu|rtx)[\s?!.]*$/],
];

export function qualRegra(texto) {
  const t = normalizar(String(texto || '').trim()).replace(/@\w+/, '');
  if (t.length > 60) return null;
  for (const [nome, re] of PADROES) if (re.test(t)) return nome;
  return null;
}

export function textoStatus(s) {
  const h = Math.floor(s.uptimeS / 3600), m = Math.floor(s.uptimeS % 3600 / 60);
  const idx = s.indexado ? new Date(s.indexado).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' }) : '—';
  const local = s.local ? `ligado (${s.localModelo})` : 'desligado (tudo que não é regra vai para a nuvem/modelo principal)';
  const nuvem = s.nuvemLocal ? `modelo principal: ${s.modelo} (Ollama local, sem chave)` : `Nuvem: ${s.modelo} (Ollama Cloud, assinatura; sem fallback pago)`;
  const hermes = s.hermes ? (s.hermes.ok ? `Hermes: no ar (${s.hermes.versao || 'ok'})` : `Hermes: ${s.hermes.motivo || 'indisponível'}`) : 'Hermes: desligado';
  const nvidia = s.nvidia ? (s.nvidia.ok ? `nvidia-app: leitura ok (${(s.nvidia.ferramentas || []).length} ferramentas)` : `nvidia-app: ${s.nvidia.motivo || 'indisponível'}`) : 'nvidia-app: desligado';
  return `JARVIS no ar há ${h}h${String(m).padStart(2, '0')}min
${nuvem}
Modelo local (classificador/trivial): ${local}
Reserva 9Router (PC): ${s.reserva ? `ligada (${s.reserva})` : 'desligada'}
${hermes}
${nvidia}
Vault: ${s.notas} notas, ${s.trechos} trechos (indexado ${idx}, Acre)${s.pendentes != null ? `\nConfirmações pendentes: ${s.pendentes}` : ''}`;
}

// ctx: { status: () => obj, resumo: async dias => obj }
export async function responderPorRegras(texto, ctx) {
  const r = qualRegra(texto);
  if (!r) return null;
  if (r === 'status') return { regra: r, texto: textoStatus(ctx.status()) + '\n\n' + textoResumo(await ctx.resumo(1)) };
  if (r === 'ajuda') return { regra: r, texto: AJUDA };
  if (r === 'permissoes') return { regra: r, texto: TEXTO_PERMISSOES };
  if (r === 'custo') return { regra: r, texto: textoResumo(await ctx.resumo(1)) + '\n\n' + textoResumo(await ctx.resumo(7)) };
  if (r === 'hermes' && ctx.textoHermes) return { regra: r, texto: await ctx.textoHermes() };
  if (r === 'nvidia' && ctx.textoNvidia) return { regra: r, texto: await ctx.textoNvidia() };
  return null;
}
