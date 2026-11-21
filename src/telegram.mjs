// Canal Telegram do JARVIS (long polling, sem dependências). Só responde ao chat do Jean.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { Confirmacoes, NIVEL } from './confirmacoes.mjs';

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

export function criarTelegram({ token, chatPermitido, dataDir, perguntar, lerConv, novaConv, auditar, status, api: apiInjetada }) {
  if (!token || !chatPermitido) { console.log('[telegram] desativado (TELEGRAM_BOT_TOKEN ou TELEGRAM_ALLOWED_CHAT_ID ausente)'); return null; }
  const permitido = String(chatPermitido);
  const dir = path.join(dataDir, 'telegram');
  const arqChats = path.join(dir, 'chats.json'), arqOffset = path.join(dir, 'offset.json');
  const confirmacoes = new Confirmacoes({ auditar: e => auditar({ canal: 'telegram', ...e }) });
  const avisados = new Map(); // chat estranho → último aviso (ms)
  const filas = new Map();    // chat → promessa (processa em ordem)
  let rodando = false, ctrl = null, offset = 0, chats = {};

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

  async function convDoChat(chatId, primeiroTexto) {
    const id = chats[chatId];
    if (id) { try { return await lerConv(id); } catch {} }
    const conv = novaConv(`[Telegram] ${primeiroTexto}`, { canal: 'telegram' });
    chats[chatId] = conv.id; await gravar(arqChats, chats);
    return conv;
  }

  const AJUDA = `Comandos:
/nova — começa uma conversa nova
/status — saúde do JARVIS (só leitura)
/parar — cancela confirmações pendentes
/testesim — mostra como funciona o botão de "sim" (não executa nada)`;

  async function comando(chatId, cmd) {
    if (cmd === '/start') return enviar(chatId, `Olá, Jean. Sou o JARVIS, agora também no Telegram. Pode perguntar em texto; uso o vault do projeto e cito as notas.\n\nNesta versão eu só converso: não executo nada.\n\n${AJUDA}`);
    if (cmd === '/nova') { delete chats[chatId]; await gravar(arqChats, chats); return enviar(chatId, 'Conversa nova iniciada. O histórico anterior continua salvo.'); }
    if (cmd === '/parar') { const n = confirmacoes.cancelarTodas(chatId); return enviar(chatId, n ? `Parado. ${n} confirmação(ões) pendente(s) cancelada(s).` : 'Parado. Não havia confirmações pendentes nem rotinas ativas.'); }
    if (cmd === '/status') {
      const s = status(); const h = Math.floor(s.uptimeS / 3600), m = Math.floor(s.uptimeS % 3600 / 60);
      const idx = s.indexado ? new Date(s.indexado).toLocaleString('pt-BR', { timeZone: 'America/Rio_Branco' }) : '—';
      return enviar(chatId, `JARVIS no ar há ${h}h${String(m).padStart(2, '0')}min\nModelo: ${s.modelo} (Ollama Cloud, sem fallback)\nVault: ${s.notas} notas, ${s.trechos} trechos (indexado ${idx}, Acre)\nConfirmações pendentes: ${confirmacoes.pendentes(chatId)}`);
    }
    if (cmd === '/testesim') {
      const c = confirmacoes.criar({ nivel: NIVEL.SIM, acao: 'teste do botão de confirmação', alvo: 'nenhum', canal: 'telegram', chatId });
      return enviar(chatId, `Ação de nível 2 (exemplo):\n• Teste do botão de confirmação — nada será executado.\nExpira em 10 minutos. Um "sim" vale para uma ação só.`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `cf:${c.id}` }, { text: '✖️ Cancelar', callback_data: `cc:${c.id}` }]] } });
    }
    return enviar(chatId, `Comando desconhecido.\n\n${AJUDA}`);
  }

  async function responder(chatId, texto) {
    const digitando = () => api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
    digitando(); const t = setInterval(digitando, 4500);
    try {
      const conv = await convDoChat(chatId, texto);
      const { resposta, fontes, erro } = await perguntar(conv, texto);
      let saida = textoPuro(resposta || '');
      if (saida && fontes.length && !/fontes\s*:/i.test(saida)) saida += `\n\n📎 Notas consultadas: ${fontes.map(f => `[[${f}]]`).join(' · ')}`;
      if (erro) saida = (saida ? saida + '\n\n' : '') + `⚠️ Erro do modelo: ${erro}\n(Não troquei para outro modelo: sem fallback.)`;
      await enviar(chatId, saida || '⚠️ Resposta vazia.');
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
    if (texto.startsWith('/')) return comando(chatId, texto.split(/[\s@]/)[0].toLowerCase());
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
