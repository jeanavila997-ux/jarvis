// Canal Telegram do JARVIS (long polling, sem dependências). Só responde ao chat do Jean.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { Confirmacoes, NIVEL } from './confirmacoes.mjs';
import { TEXTO_PERMISSOES } from './regras.mjs';
import { textoResumo } from './uso.mjs';
import { interpretarPedidoHermes } from './hermes.mjs';
import { interpretarPedidoVoz, textoVozStatus } from './voz.mjs';

const LIMITE = 4000;

export function dividir(texto, max = LIMITE) {
  const partes = []; let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf('\n', max);
    if (corte < max * 0.5) corte = resto.lastIndexOf(' ', max);
    if (corte < max * 0.5) corte = max;
    partes.push(resto.slice(0, corte)); resto = resto.slice(corte).replace(/^\s+/, '');
  }
  if (resto) partes.push(resto);
  return partes;
}

// Texto puro (sem parse_mode): tira marcações de markdown que ficariam feias.
export function textoPuro(md) {
  return md.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^```\w*\s*$/gm, '').trim();
}

export function criarTelegram({ token, chatPermitido, dataDir, perguntar, lerConv, novaConv, salvarConv, skills, auditar, status, resumo = async () => ({ total: 0, dias: 1 }), api: apiInjetada, hermes = null, nvidia = null, textoHermes = null, textoNvidia = null, textoGithub = null, mestre = null, textoMestre = null, voz = null, textoVoz = null }) {
  if (!token || !chatPermitido) { console.log('[telegram] desativado (TELEGRAM_BOT_TOKEN ou TELEGRAM_ALLOWED_CHAT_ID ausente)'); return null; }
  const permitido = String(chatPermitido);
  const dir = path.join(dataDir, 'telegram');
  const arqChats = path.join(dir, 'chats.json'), arqOffset = path.join(dir, 'offset.json');
  const confirmacoes = new Confirmacoes({ auditar: e => auditar({ canal: 'telegram', ...e }) });
  const avisados = new Map(); // chat estranho → último aviso (ms)
  const filas = new Map();    // chat → promessa (processa em ordem)
  let rodando = false, ctrl = null, offset = 0, chats = {};
  let rotinas = null;

  // Nunca logar a URL (contém o token).
  const api = apiInjetada || (async (metodo, corpo = {}, timeoutMs = 70000) => {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, { method: 'POST', signal: c.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      return await r.json();
    } finally { clearTimeout(t); }
  });

  async function carregarEstado() {
    await mkdir(dir, { recursive: true });
    try { chats = JSON.parse(await readFile(arqChats, 'utf8')); } catch { chats = {}; }
    try { offset = JSON.parse(await readFile(arqOffset, 'utf8')).offset || 0; } catch { offset = 0; }
  }
  async function gravar(arq, obj) { const tmp = arq + '.tmp'; await writeFile(tmp, JSON.stringify(obj)); await rename(tmp, arq); }

  async function enviar(chatId, texto, extra = {}) {
    let ultima = null;
    for (const parte of dividir(texto)) {
      const r = await api('sendMessage', { chat_id: chatId, text: parte, link_preview_options: { is_disabled: true }, ...extra });
      if (!r?.ok) console.error('[telegram] sendMessage falhou:', r?.error_code, r?.description);
      ultima = r;
    }
    return ultima;
  }

  async function enviarVoz(chatId, ogg, caption = '') {
    if (!ogg || !ogg.length) throw new Error('áudio vazio');
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('voice', new Blob([ogg], { type: 'audio/ogg' }), 'voz.ogg');
    if (caption) form.set('caption', String(caption).slice(0, 1024));
    const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, { method: 'POST', body: form });
    const j = await r.json().catch(() => ({ ok: false, description: 'resposta inválida' }));
    if (!j?.ok) console.error('[telegram] sendVoice falhou:', j?.error_code, j?.description);
    return j;
  }

  async function convDoChat(chatId, primeiroTexto) {
    const id = chats[chatId];
    if (id) { try { return await lerConv(id); } catch {} }
    const conv = novaConv(`[Telegram] ${primeiroTexto}`, { canal: 'telegram' });
    chats[chatId] = conv.id; await gravar(arqChats, chats);
    return conv;
  }

  const AJUDA = `Comandos:
/nova — começa uma conversa nova
/status — saúde do JARVIS e da VPS (só leitura)
/custo — uso e custo por rota (regras, local, nuvem)
/permissoes — os 4 níveis de permissão
/ajuda — esta lista
/briefing — mostra o briefing da manhã agora (automático às 06:30)
/revisao — revisão do dia e escreve o diário (automático às 21:00)
/reindexar — reindexa o vault (nível 1: faz e avisa)
/parar — cancela confirmações e pausa as rotinas
/retomar — reativa as rotinas
/skills — lista as skills instaladas (texto instrucional, nunca executam comandos)
/skill <nome> — ativa/desativa a skill NESTA conversa (/skill off tira todas)
/testesim — mostra como funciona o botão de "sim" (não executa nada)
/hermes — status do Hermes (leitura); tarefas se houver chave
/nvidia — status da GPU (nvidia-app, só leitura)
/github — status do GitHub via Docker MCP (leitura; escrita pede "sim")
/mestre — status do Mestre do PC; /mestre <ferramenta> [json|texto] pede a ação (nível 2 com botão; destrutivo é recusado)
/voz — status do Voicebox; /voz <frase> gera áudio; /voz ligar (ou "responder em áudio") fala as respostas`;

  async function comando(chatId, cmd, args = '') {
    if (cmd === '/start') return enviar(chatId, `Olá, Jean. Sou o JARVIS, agora também no Telegram. Pode perguntar em texto; uso o vault do projeto e cito as notas.\n\nFaço rotinas de nível 0-1: briefing 06:30, revisão 21:00 com diário, reindexação e status. Nada destrutivo — nível 2+ sempre pede seu "sim".\n\n${AJUDA}`);
    if (cmd === '/nova') { delete chats[chatId]; await gravar(arqChats, chats); return enviar(chatId, 'Conversa nova iniciada. O histórico anterior continua salvo.'); }
    if (cmd === '/parar') {
      const n = confirmacoes.cancelarTodas(chatId);
      const p = rotinas ? await rotinas.pausar() : null;
      return enviar(chatId, `Parado. ${n} confirmação(ões) cancelada(s); rotinas ${p ? 'pausadas' : 'não estavam ativas'}. /retomar para voltar.`);
    }
    if (cmd === '/retomar') {
      if (!rotinas) return enviar(chatId, 'Rotinas não estão ativas nesta instalação.');
      await rotinas.retomar(); const d = rotinas.dados();
      return enviar(chatId, `Rotinas reativadas: briefing ${d.briefing} · revisão ${d.revisao} (Acre).`);
    }
    if (cmd === '/skills' || cmd === '/skill') {
      if (!skills || typeof salvarConv !== 'function') return enviar(chatId, 'Módulo de skills não está ativo nesta instalação.');
      const lista = await skills.listar();
      if (!lista.length) return enviar(chatId, 'Nenhuma skill instalada. O Hermes instala em data/skills/<nome>/SKILL.md na VPS.');
      if (cmd === '/skills' || !args) return enviar(chatId, `Skills instaladas:\n${lista.map(s => `• ${s.nome} — ${s.descricao}`).join('\n')}\n\nAtiva na conversa com /skill <nome>.`);
      const pedido = args.toLowerCase().split(/\s+/).filter(Boolean).map(a => a.replace(/^[\-\/]/, ''));
      const convAtual = (chats[chatId] ? await lerConv(chats[chatId]).catch(() => null) : null);
      if (!convAtual) return enviar(chatId, 'Mande uma mensagem primeiro (conversa atual), depois ative a skill com /skill <nome>.');
      if (pedido[0] === 'off' || pedido[0] === 'nenhuma' || pedido[0] === 'todas') {
        convAtual.skills = []; await salvarConv(convAtual);
        return enviar(chatId, 'Skills desativadas nesta conversa.');
      }
      const desconhecidas = pedido.filter(n => !lista.some(s => s.nome === n));
      if (desconhecidas.length) return enviar(chatId, `Skill não instalada: ${desconhecidas.join(', ')}. /skills mostra a lista.`);
      const atuais = new Set(convAtual.skills || []);
      if (atuais.has(pedido[0])) atuais.delete(pedido[0]); else for (const n of pedido) atuais.add(n);
      convAtual.skills = [...atuais]; await salvarConv(convAtual);
      return enviar(chatId, convAtual.skills.length
        ? `Skills ativas nesta conversa: ${convAtual.skills.join(', ')}. O texto delas entra no prompt das próximas respostas.`
        : 'Nenhuma skill ativa nesta conversa.');
    }
    if (cmd === '/briefing') {

      if (!rotinas) return enviar(chatId, 'Rotinas não estão ativas nesta instalação.');
      auditar({ nivel: 0, acao: 'briefing-manual', alvo: 'telegram', resultado: 'ok' });
      return enviar(chatId, await rotinas.textoBriefing());
    }
    if (cmd === '/revisao') {
      if (!rotinas) return enviar(chatId, 'Rotinas não estão ativas nesta instalação.');
      auditar({ nivel: 1, acao: 'revisao-manual', alvo: 'telegram', resultado: 'ok' });
      return enviar(chatId, await rotinas.textoRevisao());
    }
    if (cmd === '/reindexar') {
      if (!rotinas?.reindexar) return enviar(chatId, 'Rotinas não estão ativas nesta instalação.');
      try {
        const r = await rotinas.reindexar();
        auditar({ nivel: 1, acao: 'reindexar-vault', alvo: 'vault', resultado: 'ok' });
        return enviar(chatId, `✅ Vault reindexado (${r}).`);
      } catch (e) {
        auditar({ nivel: 1, acao: 'reindexar-vault', alvo: 'vault', resultado: 'erro', erro: e.message });
        return enviar(chatId, `⚠️ Falhou: ${e.message}`);
      }
    }
    if (cmd === '/custo' || cmd === '/custos') return enviar(chatId, textoResumo(await resumo(1)) + '\n\n' + textoResumo(await resumo(7)));
    if (cmd === '/permissoes') return enviar(chatId, TEXTO_PERMISSOES);
    if (cmd === '/ajuda' || cmd === '/help') return enviar(chatId, AJUDA);
    if (cmd === '/status') {
      const s = status(); const h = Math.floor(s.uptimeS / 3600), m = Math.floor(s.uptimeS % 3600 / 60);
      const idx = s.indexado ? new Date(s.indexado).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' }) : '—';
      const d = rotinas ? rotinas.dados() : null;
      const vps = rotinas ? (await rotinas.vpsLinha()) : '';
      return enviar(chatId, `JARVIS no ar há ${h}h${String(m).padStart(2, '0')}min\nNuvem: ${s.modelo} (Ollama Cloud, sem fallback pago)\nModelo local: ${s.local ? `ligado (${s.localModelo})` : 'desligado'}\nReserva 9Router: ${s.reserva ? `ligada (${s.reserva})` : 'desligada'}\nVault: ${s.notas} notas, ${s.trechos} trechos (indexado ${idx}, Acre)\nRotinas: ${d ? (d.pausado ? `PAUSADAS (briefing ${d.briefing} · revisão ${d.revisao})` : `briefing ${d.briefing} · revisão ${d.revisao} (Acre)`) : 'não ativas'}${vps ? '\n' + vps : ''}${s.voicebox ? '\nVoicebox: ' + (s.voicebox.ok ? ('ok pelo ' + (s.voicebox.alvo === 'pc' ? 'PC' : 'VPS')) : ('indisponível (' + (s.voicebox.motivo || '?') + ')')) : '\nVoicebox: desligado'}\nConfirmações pendentes: ${confirmacoes.pendentes(chatId)}\n\n${textoResumo(await resumo(1))}`);
    }
    if (cmd === '/testesim') {
      const c = confirmacoes.criar({ nivel: NIVEL.SIM, acao: 'teste do botão de confirmação', alvo: 'nenhum', canal: 'telegram', chatId });
      return enviar(chatId, `Ação de nível 2 (exemplo):\n• Teste do botão de confirmação — nada será executado.\nExpira em 10 minutos. Um "sim" vale para uma ação só.`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `cf:${c.id}` }, { text: '✖️ Cancelar', callback_data: `cc:${c.id}` }]] } });
    }
    if (cmd === '/hermes') {
      if (!textoHermes) return enviar(chatId, 'Hermes não está ligado nesta instalação (HERMES_URL).');
      return enviar(chatId, await textoHermes());
    }
    if (cmd === '/nvidia') {
      if (!textoNvidia) return enviar(chatId, 'nvidia-app não está ligado nesta instalação.');
      return enviar(chatId, await textoNvidia());
    }
    if (cmd === '/github') {
      if (!textoGithub) return enviar(chatId, 'GitHub (Docker MCP) não está ligado nesta instalação.');
      return enviar(chatId, await textoGithub());
    }
    if (cmd === '/mestre') {
      if (!mestre?.ativa) return enviar(chatId, 'Mestre do PC: desligado (MESTRE_MCP=0 ou túnel do PC ainda não existe).');
      if (!args) return enviar(chatId, await textoMestre());
      const [nome, ...resto] = args.split(/\s+/); const r = resto.join(' ').trim();
      let a = {};
      if (r.startsWith('{')) { try { a = JSON.parse(r); } catch { return enviar(chatId, 'JSON inválido. Nada foi feito.'); } }
      else if (r) a = nome === 'run_operation' ? { operation: r } : { texto: r };
      const p = mestre.prepararAcao({ confirmacoes, nome, args: a, canal: 'telegram', chatId, auditar: e => auditar({ canal: 'telegram', ...e }) });
      if (p.recusado) return enviar(chatId, p.motivo);
      if (p.executarAgora) { try { const x = await p.executarAgora(); return enviar(chatId, String(x.texto).slice(0, 3500)); } catch (e) { return enviar(chatId, 'Mestre do PC: ' + e.message); } }
      return enviar(chatId, `Ação de nível 2: ${p.rotulo}\nConfirme no botão (10 min, uso único).`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `cf:${p.id}` }, { text: '✖️ Cancelar', callback_data: `cc:${p.id}` }]] } });
    }
    if (cmd === '/voz') {
      if (!voz?.ativa) return enviar(chatId, textoVoz ? await textoVoz() : textoVozStatus({}, { ligada: false }));
      const ped = interpretarPedidoVoz(`/voz ${args}`.trim());
      if (!ped || ped.acao === 'status') return enviar(chatId, await statusVozChat(chatId));
      const conv = chats[chatId] ? await lerConv(chats[chatId]).catch(() => null) : null;
      if (ped.acao === 'ligar') {
        if (!conv) return enviar(chatId, 'Mande uma mensagem primeiro, depois diga "responder em áudio" ou /voz ligar.');
        conv.voz = true; await salvarConv(conv);
        return enviar(chatId, 'Neste chat, as próximas respostas também saem em áudio. /voz off (ou "só texto") desliga. /voz <frase> gera um áudio avulso.');
      }
      if (ped.acao === 'desligar') {
        if (conv) { conv.voz = false; await salvarConv(conv); }
        return enviar(chatId, 'Neste chat, voltei a responder só em texto. /voz <frase> ainda gera um áudio avulso.');
      }
      if (ped.acao === 'falar') return falarTelegram(chatId, ped.texto);
    }
    return enviar(chatId, `Comando desconhecido.\n\n${AJUDA}`);
  }

  async function statusVozChat(chatId) {
    const conv = chats[chatId] ? await lerConv(chats[chatId]).catch(() => null) : null;
    const s = voz?.ativa ? await voz.saudavel() : { ok: false, motivo: 'desligado' };
    return textoVozStatus(s, { ligada: Boolean(voz?.ativa), modoConversa: Boolean(conv?.voz) });
  }

  async function falarTelegram(chatId, texto) {
    await api('sendChatAction', { chat_id: chatId, action: 'record_voice' }).catch(() => {});
    try {
      const r = await voz.gerar(texto);
      const cap = r.alvo === 'pc' ? 'Voicebox · PC' : 'Voicebox · VPS';
      const envio = await enviarVoz(chatId, r.ogg, `${cap} · ${r.ms} ms`);
      if (!envio?.ok) await enviar(chatId, `Gerei o áudio, mas o Telegram recusou o envio: ${envio?.description || 'erro'}.`);
    } catch (e) {
      await enviar(chatId, 'Voicebox: ' + e.message);
    }
  }

  async function pedidoHermesTelegram(chatId, texto) {
    if (!hermes?.ativa) return false;
    const ped = interpretarPedidoHermes(texto);
    if (!ped || ped.nivel < 2) return false;
    if (ped.erro) { await enviar(chatId, `Pedido de nível 2 (${ped.rotulo}), mas falta dado: ${ped.erro}. Nada foi feito.`); return true; }
    const c = confirmacoes.criar({
      nivel: NIVEL.SIM, acao: ped.rotulo, alvo: ped.id || '', canal: 'telegram', chatId,
      executar: async () => {
        const r = await hermes.executar(ped);
        const detalhe = typeof r === 'string' ? r : JSON.stringify(r);
        return `Feito: ${ped.rotulo}. ${String(detalhe).slice(0, 400)}`;
      },
    });
    if (c.recusado) { await enviar(chatId, c.motivo); return true; }
    await enviar(chatId, `Ação de nível 2:\n• ${ped.rotulo}\nExpira em 10 minutos. Um "sim" vale para uma ação só. Nada será feito antes da confirmação.`,
      { reply_markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `cf:${c.id}` }, { text: '✖️ Cancelar', callback_data: `cc:${c.id}` }]] } });
    return true;
  }

  async function responder(chatId, texto) {
    const digitando = () => api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    digitando(); const t = setInterval(digitando, 4500);
    try {
      if (await pedidoHermesTelegram(chatId, texto)) return;
      const pedVoz = interpretarPedidoVoz(texto);
      if (pedVoz) {
        if (!voz?.ativa && pedVoz.acao !== 'status') {
          await enviar(chatId, textoVozStatus({}, { ligada: false }));
          return;
        }
        if (pedVoz.acao === 'status') { await enviar(chatId, await statusVozChat(chatId)); return; }
        if (pedVoz.acao === 'ligar' || pedVoz.acao === 'desligar' || pedVoz.acao === 'falar') {
          await comando(chatId, '/voz', pedVoz.acao === 'falar' ? pedVoz.texto : pedVoz.acao === 'ligar' ? 'ligar' : 'off');
          return;
        }
      }
      const conv = await convDoChat(chatId, texto);
      const { resposta, fontes, erro, rota } = await perguntar(conv, texto, { canal: 'telegram' });
      let saida = textoPuro(resposta || '');
      if (saida && rota !== 'regras' && rota !== 'plano-b-regras' && fontes.length && !/fontes\s*:/i.test(saida)) saida += `\n\n📎 Notas consultadas: ${fontes.map(f => `[[${f}]]`).join(' · ')}`;
      if (erro && rota !== 'plano-b-regras') saida = (saida ? saida + '\n\n' : '') + `⚠️ Erro do modelo: ${erro}\n(Sem fallback pago.)`;
      await enviar(chatId, saida || '⚠️ Resposta vazia.');
      if (voz?.ativa && conv.voz && saida) {
        try { await falarTelegram(chatId, saida); }
        catch (e) { await enviar(chatId, 'Não consegui falar a resposta: ' + e.message); }
      }
    } finally { clearInterval(t); }
  }

  async function tratarUpdate(u) {
    if (u.callback_query) {
      const q = u.callback_query, de = String(q.from?.id), chatId = String(q.message?.chat?.id ?? de);
      if (de !== permitido || chatId !== permitido) {
        auditar({ canal: 'telegram', acao: 'callback-negado', chat: chatId, resultado: 'ignorado' });
        return api('answerCallbackQuery', { callback_query_id: q.id, text: 'Não autorizado.' });
      }
      const m = String(q.data || '').match(/^(cf|cc):([a-f0-9]{12})$/);
      const r = m ? await confirmacoes.resolver(m[2], { confirmar: m[1] === 'cf', chatId }) : { ok: false, msg: 'Botão inválido.' };
      await api('answerCallbackQuery', { callback_query_id: q.id, text: r.msg.slice(0, 190) });
      if (q.message) await api('editMessageText', { chat_id: chatId, message_id: q.message.message_id, text: `${q.message.text || ''}\n\n→ ${r.msg}` });
      return;
    }
    const msg = u.message; if (!msg) return;
    const chatId = String(msg.chat.id), de = String(msg.from?.id);
    if (chatId !== permitido || de !== permitido) {
      auditar({ canal: 'telegram', acao: 'mensagem-de-chat-nao-autorizado', chat: chatId, tipo_chat: msg.chat.type, resultado: 'ignorado' });
      const ult = avisados.get(chatId) || 0;
      if (Date.now() - ult > 6 * 3600 * 1000) { avisados.set(chatId, Date.now()); await enviar(chatId, 'Este assistente é privado.'); }
      return;
    }
    if (!msg.text) return enviar(chatId, 'Por enquanto só entendo mensagens de texto.');
    const texto = msg.text.trim();
    if (texto.startsWith('/')) {
      const bruto = texto.split(/\s+/)[0];
      return comando(chatId, bruto.split(/[\s@]/)[0].toLowerCase(), texto.slice(bruto.length).trim());
    }
    if (texto.length > 8000) return enviar(chatId, 'Mensagem longa demais (máx. 8000 caracteres).');
    return responder(chatId, texto);
  }

  // Processa em ordem por chat, sem travar o polling.
  function enfileirar(u) {
    const chave = String(u.message?.chat?.id ?? u.callback_query?.from?.id ?? 'x');
    const p = (filas.get(chave) || Promise.resolve()).then(() => tratarUpdate(u)).catch(e => console.error('[telegram] erro ao tratar update:', e.message));
    filas.set(chave, p);
  }

  async function loop() {
    console.log('[telegram] polling iniciado (getUpdates)');
    while (rodando) {
      try {
        const r = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
        if (!r.ok) {
          if (r.error_code === 409) console.error('[telegram] 409: outro processo usa este bot (webhook ou getUpdates). Tentando de novo em 30s.');
          else console.error('[telegram] getUpdates falhou:', r.error_code, r.description);
          await new Promise(s => setTimeout(s, r.error_code === 409 ? 30000 : 10000)); continue;
        }
        for (const u of r.result) { offset = u.update_id + 1; enfileirar(u); }
        if (r.result.length) await gravar(arqOffset, { offset });
      } catch (e) {
        if (!rodando) break;
        console.error('[telegram] erro de rede no polling:', e.name === 'AbortError' ? 'timeout' : e.message);
        await new Promise(s => setTimeout(s, 5000));
      }
    }
  }

  return {
    tratarUpdate, confirmacoes,
    ligarRotinas(r) { rotinas = r; },
    enviar,
    async iniciar() {
      await carregarEstado();
      const me = await api('getMe').catch(e => ({ ok: false, description: e.message }));
      if (!me.ok) { console.error('[telegram] getMe falhou:', me.error_code, me.description, '— canal desativado'); return; }
      console.log(`[telegram] conectado como @${me.result.username}; aceitando só o chat permitido`);
      rodando = true; loop();
    },
    parar() { rodando = false; },
  };
}
