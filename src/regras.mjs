// Respostas fixas, sem IA e sem custo, para status/ajuda/comandos/custo/permissões.
// Só casa mensagens curtas e explícitas (ex.: "status", "/ajuda", "quais os comandos?").
import { normalizar } from './retrieval.mjs';
import { textoResumo } from './uso.mjs';

export const AJUDA = `Comandos (respondidos por regra, sem IA):
/status — saúde do JARVIS e rotas
/custo — uso e custo por rota (hoje e 7 dias)
/permissoes — os 4 níveis de permissão
/ajuda — esta lista
No Telegram também: /nova (conversa nova), /parar (cancela confirmações), /testesim (demonstra o botão de "sim").`;

export const TEXTO_PERMISSOES = `Níveis de permissão (docs/PERMISSOES.md, aplicados por regra fixa, não pela IA):
0 · Livre — responder, ler, buscar no vault.
1 · Faz e avisa — só coisas do próprio JARVIS (diário, rascunho, lembrete), sempre auditado.
2 · Precisa de "sim" — enviar mensagem, agenda, editar arquivo, reiniciar serviço, git, gastar. Botão de confirmação, 10 min, uso único.
3 · Proibido — apagar dados/backups, force-push, expor segredo, abrir porta, fallback pago. Só o Jean faz.
Nesta versão ainda não tenho ferramentas: tudo que eu faço é nível 0.`;

const PADROES = [
  ['status', /^\/?(status|saude|como\s+voce\s+esta\s+de\s+saude|voce\s+esta\s+(no\s+ar|online))[\s?!.]*$/],
  ['ajuda', /^\/?(ajuda|help|start|comandos|menu|quais\s+(sao\s+)?(os\s+)?(seus\s+)?comandos|o\s+que\s+voce\s+(sabe\s+)?faz(er)?)[\s?!.]*$/],
  ['custo', /^\/?(custo|custos|uso|gasto|gastos|quanto\s+(voce\s+)?(gastou|gastei|custou))[\s?!.]*$/],
  ['permissoes', /^\/?(permissoes|permissao|niveis(\s+de\s+permissao)?)[\s?!.]*$/],
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
  const local = s.local ? `ligado (${s.localModelo})` : 'desligado (tudo que não é regra vai para a nuvem)';
  return `JARVIS no ar há ${h}h${String(m).padStart(2, '0')}min
Nuvem: ${s.modelo} (Ollama Cloud, assinatura; sem fallback pago)
Modelo local: ${local}
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
  return null;
}
