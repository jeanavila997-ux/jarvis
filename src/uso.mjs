// Registro de uso/custo por rota (JSONL, só acrescenta): data/uso.jsonl
// Uma linha por resposta: ts (Acre), canal, rota, modelo, motivo, nota, tipo, nivel, ms, tokens, custo.
// Custo: regras e local = 0; nuvem = incluso na assinatura do Ollama Cloud (registra tokens para medir).
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

export const arqUso = dataDir => path.join(dataDir, 'uso.jsonl');
export const tsAcre = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'America/Rio_Branco' }).replace(' ', 'T') + '-05:00';

export async function registrarUso(dataDir, e) {
  const linha = { ts: tsAcre(), ...e, custo_usd: 0, cobranca: e.rota === 'nuvem' ? 'assinatura-ollama-cloud' : e.rota === 'reserva-9router' ? 'reserva-9router-pc-do-jean' : 'gratis' };
  try { await appendFile(arqUso(dataDir), JSON.stringify(linha) + '\n'); }
  catch (err) { console.error('[uso] falha ao gravar:', err.message); }
}

// Resumo por dia e rota (últimos N dias, horário do Acre).
export async function resumoUso(dataDir, dias = 1) {
  let txt = '';
  try { txt = await readFile(arqUso(dataDir), 'utf8'); } catch { return { dias, total: 0, rotas: {}, porDia: {} }; }
  const limite = tsAcre(new Date(Date.now() - (dias - 1) * 86400000)).slice(0, 10);
  const rotas = {}, porDia = {}; let total = 0;
  for (const l of txt.split('\n')) {
    if (!l) continue;
    let e; try { e = JSON.parse(l); } catch { continue; }
    const dia = String(e.ts).slice(0, 10);
    if (dia < limite) continue;
    total++;
    const r = (rotas[e.rota] ||= { chamadas: 0, tokens: 0, ms: 0, erros: 0, planoB: 0 });
    r.chamadas++; r.tokens += (e.tokens_in || 0) + (e.tokens_out || 0); r.ms += e.ms || 0;
    if (e.erro) r.erros++; if (String(e.motivo || '').startsWith('plano-b')) r.planoB++;
    ((porDia[dia] ||= {})[e.rota] = (porDia[dia][e.rota] || 0) + 1);
  }
  return { dias, total, rotas, porDia };
}

export function textoResumo(s) {
  if (!s.total) return `Uso (${s.dias === 1 ? 'hoje' : `últimos ${s.dias} dias`}): nenhuma resposta registrada ainda.`;
  const nomes = { regras: 'Regras (sem IA)', local: 'Local (Ollama VPS)', nuvem: 'Nuvem (Ollama Cloud)', 'plano-b-regras': 'Plano B por regras', 'reserva-9router': 'Reserva 9Router (PC)' };
  const linhas = Object.entries(s.rotas).map(([k, r]) => `• ${nomes[k] || k}: ${r.chamadas} resp., ${r.tokens} tokens, média ${Math.round(r.ms / r.chamadas / 100) / 10}s${r.erros ? `, ${r.erros} erro(s)` : ''}${r.planoB ? `, ${r.planoB} plano B` : ''}`);
  return `Uso (${s.dias === 1 ? 'hoje' : `últimos ${s.dias} dias`}, Acre): ${s.total} respostas\n${linhas.join('\n')}\nCusto extra: US$ 0 (local grátis; nuvem dentro da assinatura; reserva 9Router só com modelo gratuito). Registro: data/uso.jsonl`;
}
