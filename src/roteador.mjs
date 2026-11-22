// Roteador de custo (Etapa 1). Ordem:
//   1) regras fixas sem IA (status/ajuda/comandos/custo) → rota "regras"
//   2) Guarda: nível por regra (PERMISSOES.md). Nível 1+ nunca vai para o modelo local.
//   3) classificador local → nota 1-2 de conversa trivial vai para o modelo local; 3+ vai para a nuvem (glm-5.3-flash)
//   4) plano B: se o local travar/falhar → nuvem atual (assinatura). Sem fallback pago novo.
import { normalizar } from './retrieval.mjs';

// Perguntas que pedem dado atual (preço, cotação, status, notícia) não vão para o modelo local:
// um modelo pequeno inventaria o número.
const DADO_ATUAL = /\b(hoje|agora|atual\w*|cotac\w*|preco|precos|valor\s+do|quanto\s+(esta|ta|custa)|noticia\w*|status|online|no\s+ar|clima|tempo\s+em|previsao|dolar|arroba|boi\s+gordo)\b/;
// O modelo local (3B, CPU) só atende conversa trivial: em teste ele inventou fatos sobre o Hermes
// quando recebeu pergunta de conteúdo. Pergunta simples só vai para o local com nota 1.
const podeLocal = c => c.tipo === 'saudacao' || (c.tipo === 'pergunta_simples' && c.nota === 1);

export function criarRoteador({ localUrl, localModel, classificar, maxCharsLocal = 280, log = () => {} }) {
  const localLigado = Boolean(localUrl && localModel);
  return {
    localLigado,
    async decidir(texto, guarda) {
      const base = { nivel: guarda.nivel };
      if (!localLigado) return { ...base, rota: 'nuvem', motivo: 'local-desligado' };
      if (guarda.nivel >= 1) return { ...base, rota: 'nuvem', motivo: `guarda-nivel-${guarda.nivel}` };
      let c;
      try { c = await classificar(texto); }
      catch (e) { log(`plano B: classificador falhou (${e.message}) → nuvem`); return { ...base, rota: 'nuvem', motivo: 'plano-b-classificador-falhou', erroLocal: e.message }; }
      const d = { ...base, nota: c.nota, tipo: c.tipo, classifMs: c.ms, classifTokens: (c.tokensIn || 0) + (c.tokensOut || 0) };
      if (c.nota >= 3) return { ...d, rota: 'nuvem', motivo: `nota-${c.nota}` };
      if (!podeLocal(c)) return { ...d, rota: 'nuvem', motivo: `tipo-${c.tipo}` };
      if (String(texto).length > maxCharsLocal) return { ...d, rota: 'nuvem', motivo: 'texto-longo' };
      if (DADO_ATUAL.test(normalizar(texto))) return { ...d, rota: 'nuvem', motivo: 'pede-dado-atual' };
      return { ...d, rota: 'local', motivo: `nota-${c.nota}` };
    },
  };
}
