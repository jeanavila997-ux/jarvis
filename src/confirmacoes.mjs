// Plumbing do "sim" (docs/PERMISSOES.md). Nenhuma ação real está ligada na v0.2.
import { randomBytes } from 'node:crypto';

export const NIVEL = { LIVRE: 0, AVISA: 1, SIM: 2, PROIBIDO: 3 };
export const VALIDADE_MS = 10 * 60 * 1000;

export class Confirmacoes {
  constructor({ auditar = () => {}, agora = () => Date.now() } = {}) { this.mapa = new Map(); this.auditar = auditar; this.agora = agora; }

  // Cria um pedido de confirmação. Nível 3 é sempre recusado; níveis 0/1 não precisam de "sim".
  criar({ nivel, acao, alvo = '', canal, chatId, executar = null }) {
    if (nivel >= NIVEL.PROIBIDO) {
      this.auditar({ nivel, acao, alvo, canal, resultado: 'recusado-nivel3' });
      return { recusado: true, motivo: 'Ação de nível 3: proibida mesmo com "sim". Só o Jean faz, ele mesmo.' };
    }
    if (nivel < NIVEL.SIM) return { recusado: true, motivo: 'Ação de nível 0/1 não usa confirmação.' };
    const id = randomBytes(6).toString('hex');
    this.mapa.set(id, { id, nivel, acao, alvo, canal, chatId: String(chatId), criado: this.agora(), executar });
    this.auditar({ nivel, acao, alvo, canal, confirmacao_id: id, resultado: 'pendente' });
    return { id, expiraEm: new Date(this.agora() + VALIDADE_MS).toISOString() };
  }

  // Resolve um clique (confirmar/cancelar). Uso único, expira em 10 min, só do chat que pediu.
  async resolver(id, { confirmar, chatId }) {
    const p = this.mapa.get(id);
    if (!p) return { ok: false, msg: 'Confirmação inexistente ou já usada.' };
    if (String(chatId) !== p.chatId) { this.auditar({ nivel: p.nivel, acao: p.acao, confirmacao_id: id, resultado: 'negado-outro-chat' }); return { ok: false, msg: 'Confirmação não pertence a este chat.' }; }
    this.mapa.delete(id); // uso único, mesmo se falhar depois
    if (this.agora() - p.criado > VALIDADE_MS) { this.auditar({ nivel: p.nivel, acao: p.acao, confirmacao_id: id, resultado: 'expirado' }); return { ok: false, msg: 'Expirou (10 min). Peça de novo.' }; }
    if (!confirmar) { this.auditar({ nivel: p.nivel, acao: p.acao, confirmacao_id: id, resultado: 'cancelado' }); return { ok: true, msg: 'Cancelado. Nada foi feito.' }; }
    const base = { nivel: p.nivel, acao: p.acao, alvo: p.alvo, canal: p.canal, confirmacao_id: id, confirmado_em: new Date(this.agora()).toISOString() };
    if (!p.executar) { this.auditar({ ...base, resultado: 'sem-acao-ligada' }); return { ok: true, msg: 'Confirmado, mas nenhuma ação real está ligada nesta versão. Nada foi feito.' }; }
    try { const r = await p.executar(); this.auditar({ ...base, resultado: 'ok' }); return { ok: true, msg: r || 'Feito.' }; }
    catch (e) { this.auditar({ ...base, resultado: 'erro', erro: e.message }); return { ok: false, msg: 'Erro: ' + e.message }; }
  }

  cancelarTodas(chatId) {
    let n = 0;
    for (const [id, p] of this.mapa) if (!chatId || p.chatId === String(chatId)) { this.mapa.delete(id); n++; this.auditar({ nivel: p.nivel, acao: p.acao, confirmacao_id: id, resultado: 'cancelado-parar' }); }
    return n;
  }
  pendentes(chatId) { const t = this.agora(); return [...this.mapa.values()].filter(p => (!chatId || p.chatId === String(chatId)) && t - p.criado <= VALIDADE_MS).length; }
}
