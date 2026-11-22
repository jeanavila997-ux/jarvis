// Rotinas do JARVIS v0.2 — briefing 06:30, revisão 21:00 (+ diário nível 1). TZ America/Rio_Branco. Sem dependências.
// Regras (docs/PERMISSOES.md): mensagem para o Jean = nível 0; escrever o próprio diário = nível 1 (faz e avisa).
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TZ = 'America/Rio_Branco';
const agoraAcre = () => {
  const p = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date());
  const v = t => Number(p.find(x => x.type === t)?.value) || 0;
  return { h: v('hour') % 24, m: v('minute'), s: v('second') };
};
const dataAcre = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const hhmmAcre = () => { const a = agoraAcre(); return hhmm(a.h, a.m); };

export function criarRotinas({ dataDir, chatPermitido, enviar = async () => {}, status = () => ({}), auditar = () => {}, indice }) {
  const timers = new Map();
  const rotinas = {
    briefing: { h: 6, m: 30 },
    revisao: { h: 21, m: 0 },
  };
  let pausado = false;
  const arqEstado = path.join(dataDir, 'rotinas.json');

  async function carregar() {
    try { const j = JSON.parse(await readFile(arqEstado, 'utf8')); pausado = !!j.pausado; } catch {}
  }
  async function gravarEstado() {
    const tmp = arqEstado + '.tmp';
    await writeFile(tmp, JSON.stringify({ pausado, atualizado: new Date().toISOString() }));
    try { await rename(tmp, arqEstado); } catch (e) { console.error('[rotinas] falha ao gravar estado:', e.message); }
  }

  function msAte({ h, m }) {
    const a = agoraAcre();
    let min = h * 60 + m - (a.h * 60 + a.m);
    if (min <= 0) min += 1440;
    return (min * 60 - a.s) * 1000;
  }
  function marcar(nome, fn) {
    const alvo = rotinas[nome];
    timers.set(nome, setTimeout(() => {
      if (!pausado) fn().catch(e => console.error(`[rotinas] erro em ${nome}:`, e.message));
      marcar(nome, fn); // re-agenda para o próximo dia
    }, msAte(alvo)));
  }
  function desmarcarTudo() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }

  // ---- leitura de dados (só leitura) ----
  let vpsCache = { lido: 0, dados: null };
  async function lerVps() {
    if (Date.now() - vpsCache.lido < 60000) return vpsCache.dados;
    try {
      vpsCache = { lido: Date.now(), dados: JSON.parse(await readFile(path.join(dataDir, 'vps-status.json'), 'utf8')) };
      const j = vpsCache.dados;
      if (j.medido && Date.now() - new Date(j.medido).getTime() > 12 * 3600e3) j.velho = true;
    } catch { vpsCache.dados = null; }
    return vpsCache.dados;
  }
  async function linhaVps() {
    const v = await lerVps();
    if (!v) return '';
    const med = v.medido ? new Date(v.medido).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—';
    const base = `VPS: disco ${v.disco ?? '—'} · RAM ${v.ram ?? '—'} · ${v.containers ?? '—'} containers no ar · hermes ${v.hermes ?? '—'} · ollama ${v.ollama ?? '—'}`;
    return (v.velho ? '' : '') + `${base} (medido ${med})`;
  }

  async function resumo({ janela24h = false } = {}) {
    const dir = path.join(dataDir, 'conversas');
    const hoje = dataAcre(), limite = Date.now() - 24 * 3600e3;
    let perguntas = 0; const conversas = new Set(); const notas = new Map();
    for (const f of await readdir(dir).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      let c; try { c = JSON.parse(await readFile(path.join(dir, f), 'utf8')); } catch { continue; }
      for (const m of c.mensagens || []) {
        if (!m.ts) continue;
        const t = new Date(m.ts).getTime();
        const doDia = janela24h ? t >= limite : new Date(m.ts).toLocaleDateString('sv-SE', { timeZone: TZ }) === hoje;
        if (!doDia) continue;
        if (m.role === 'user') { perguntas++; conversas.add(c.id); }
        for (const n of m.fontes || []) notas.set(n, (notas.get(n) || 0) + 1);
      }
    }
    return { perguntas, conversas: conversas.size, notas: [...notas.entries()].sort((a, b) => b[1] - a[1]) };
  }

  // ---- diário (nível 1: faz e avisa) ----
  async function escreverDiario(de = 'rotina') {
    const s = status(), r = await resumo({ janela24h: false });
    const hoje = dataAcre(), dir = path.join(dataDir, 'diario');
    await mkdir(dir, { recursive: true });
    const arquivo = path.join(dir, `${hoje}-jarvis.md`);
    const top = r.notas.slice(0, 5).map(([n, c]) => `[[${n}]] (${c}x)`).join(', ') || 'nenhuma';
    const conteudo = `# Diário do JARVIS — ${hoje}

## Trabalhado
- ${r.perguntas} pergunta(s) de ${r.perguntas ? r.conversas : 0} conversa(s) hoje; vault com ${s.notas} notas / ${s.trechos} trechos.
- Notas consultadas hoje: ${top}.
- Rotinas no ar: briefing ${hhmm(rotinas.briefing.h, rotinas.briefing.m)} e revisão ${hhmm(rotinas.revisao.h, rotinas.revisao.m)} (Acre).${de === 'comando' ? ' Diário pedido manualmente via /revisao.' : ''}

## Aprendido
- Nada factual para registrar além dos números acima (rotina só relata o que mediu).

## Decisões
- Nenhuma decisão externa; escrita deste diário é nível 1 (faz e avisa).

## Em andamento
- Primeira ferramenta de nível 2 real (aguarda integração externa aprovada pelo Jean).
`;
    const tmp = arquivo + '.tmp';
    await writeFile(tmp, conteudo);
    try { await rename(tmp, arquivo); } catch (e) { throw new Error('falha ao gravar diário: ' + e.message); }
    auditar({ nivel: 1, acao: 'escrever-diario', alvo: `data/diario/${hoje}-jarvis.md`, resultado: 'ok' });
    return arquivo;
  }

  // ---- textos ----
  async function textoBriefing() {
    const s = status(), r = await resumo({ janela24h: true }), vps = await linhaVps();
    const partes = [
      `☀️ Bom dia, Jean — ${dataAcre().split('-').reverse().join('/')} (${hhmmAcre()} do Acre).`,
      `JARVIS: no ar · modelo ${s.modelo} (sem fallback). Vault: ${s.notas} notas / ${s.trechos} trechos.`,
      `Últimas 24 h: ${r.perguntas} pergunta(s) em ${r.perguntas ? r.conversas : 0} conversa(s). Notas mais consultadas: ${r.notas.slice(0, 3).map(([n]) => `[[${n}]]`).join(', ') || 'nenhuma'}.`,
      vps,
      `Próxima rotina: revisão ${hhmm(rotinas.revisao.h, rotinas.revisao.m)} + diário. /parar pausa, /retomar volta.`,
    ];
    return partes.filter(Boolean).join('\n');
  }
  async function textoRevisao() {
    const r = await resumo({ janela24h: false });
    const arquivo = await escreverDiario();
    const partes = [
      `🌙 Revisão do dia (${dataAcre().split('-').reverse().join('/')}): ${r.perguntas} pergunta(s) em ${r.perguntas ? r.conversas : 0} conversa(s).`,
      r.notas.length ? `Notas consultadas hoje: ${r.notas.slice(0, 5).map(([n]) => `[[${n}]]`).join(', ')}.` : 'Sem consultas ao vault hoje.',
      `✍️ Diário escrito (nível 1): data/diario/${dataAcre()}-jarvis.md — já entra no vault na cópia das 22:00.`,
      `Próxima rotina: briefing ${hhmm(rotinas.briefing.h, rotinas.briefing.m)} de amanhã.`,
    ];
    return partes.filter(Boolean).join('\n');
  }

  async function mandarRotina(tipo) { await enviar(chatPermitido, tipo === 'briefing' ? await textoBriefing() : await textoRevisao()); auditar({ nivel: 0, acao: tipo, alvo: 'telegram', resultado: 'ok' }); }

  // ---- API pública ----
  return {
    async ligar() { await carregar(); await gravarEstado(); marcar('briefing', () => mandarRotina('briefing')); marcar('revisao', () => mandarRotina('revisao')); console.log(`[rotinas] agendado: briefing ${hhmm(rotinas.briefing.h, rotinas.briefing.m)} · revisão ${hhmm(rotinas.revisao.h, rotinas.revisao.m)} (Acre)${pausado ? ' · PAUSADO' : ''}`); },
    async pausar() { pausado = true; await gravarEstado(); return true; },
    async retomar() { pausado = false; await gravarEstado(); return true; },
    pausado: () => pausado,
    dados: () => ({ briefing: hhmm(rotinas.briefing.h, rotinas.briefing.m), revisao: hhmm(rotinas.revisao.h, rotinas.revisao.m), pausado }),
    reindexar: async () => { const r = await indice.reindexar(); return `notas: ${r.notas}, trechos: ${r.trechos}`; },
    vpsLinha: linhaVps,
    textoBriefing, textoRevisao,
    briefingAgora: async () => { await mandarRotina('briefing'); },
    revisaoAgora: async () => { await mandarRotina('revisao'); },
    escreverDiario,
    parar() { desmarcarTudo(); },
  };
}
