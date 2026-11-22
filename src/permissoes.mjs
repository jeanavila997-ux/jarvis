// Camada Guarda: o NÍVEL de permissão é decidido SÓ por estas regras fixas (docs/PERMISSOES.md),
// nunca pelo classificador nem pelo modelo. Na dúvida vale o nível mais alto.
// Nesta versão o JARVIS não tem ferramentas: o nível serve para auditar, avisar o modelo e
// impedir que pedidos sensíveis (nível 1+) vão para o modelo local pequeno.
import { normalizar } from './retrieval.mjs';

// Cada regra: [nível, rótulo, regex sobre o texto normalizado (minúsculo, sem acento)].
export const REGRAS_NIVEL = [
  // Nível 3 · Proibido (nem com "sim")
  [3, 'apagar dados/backups/volumes', /\b(apag\w*|delet\w*|exclu\w*|remov\w*|destru\w*|limp\w*)\b.{0,40}\b(dados|backups?|conversas?|reposit\w*|repo|volumes?|banco|database|tabela|vault|logs?|auditoria)\b|\brm\s+-rf\b|\bdrop\s+(table|database)\b|\bdocker\s+(volume\s+rm|system\s+prune)\b/],
  [3, 'git destrutivo', /\breset\s+--hard\b|\bpush\s+(-f|--force)\b|\bforce[\s-]?push\b/],
  [3, 'expor segredo', /\b(mostr\w*|imprim\w*|envi\w*|mand(a|e|ar|ou)|revel\w*|pass(a|e|ar)|qual\s+(e|eh)|me\s+d[aeê])\b.{0,30}\b(senhas?|tokens?|chaves?|api[\s_-]?keys?|segredos?|credenc\w*|\.env)\b/],
  [3, 'desligar proteção / abrir porta', /\b(deslig\w*|desativ\w*|desabilit\w*|tir\w*|remov\w*)\b.{0,30}\b(firewall|ufw|auth\w*|https|tls|senha|basic[\s-]?auth|2fa)\b|\babr\w*\b.{0,20}\bporta\b|\bufw\s+(disable|allow)\b/],
  [3, 'fallback pago / trocar modelo do Hermes', /\bfallback\s+pago\b|\b(troc\w*|mud\w*|alter\w*)\b.{0,30}\bmodelo\b.{0,20}\bhermes\b/],
  [3, 'mexer nas próprias permissões/auditoria', /\b(mud\w*|alter\w*|edit\w*|apag\w*|desativ\w*)\b.{0,30}\b(suas?\s+permiss\w*|permissoes\.md|auditoria)\b/],
  // Nível 2 · Precisa de "sim"
  [2, 'enviar mensagem/e-mail/post', /\b(envi\w*|mand(a|e|ar|ou|ei)|dispar\w*|post(a|e|ar|ou)|public(a|ar|ou|que)|respond\w*\s+(o|a|ao|pro|pra))\b.{0,40}\b(mensage\w*|e-?mail|emails?|whats\w*|zap|telegram|sms|post|tweet|cliente|grupo)\b/],
  [2, 'agenda/evento', /\b(cri\w*|marc\w*|agend\w*|desmarc\w*|cancel\w*)\b.{0,30}\b(evento|reuniao|compromisso|agenda|horario|visita)\b/],
  [2, 'editar arquivo/config', /\b(edit\w*|alter\w*|mud\w*|escrev\w*|salv\w*|sobrescrev\w*)\b.{0,30}\b(arquivo|config\w*|\.ya?ml|compose|nginx|traefik|crontab|vault)\b/],
  [2, 'reiniciar/derrubar serviço', /\b(reinici\w*|restart\w*|reboot\w*|par(e|ar|ou|ando)|derrub\w*|sub[ai]\w*|deploy\w*)\b.{0,30}\b(servi[cç]o|container\w*|docker|vps|servidor|hermes|n8n|traefik|ollama|app)\b/],
  [2, 'git commit/push/PR', /\bgit\s+(commit|push|merge)\b|\b(abr\w*|mescl\w*|merge\w*)\b.{0,20}\b(pr|pull\s+request)\b/],
  [2, 'rodar comando', /\b(rod\w*|execut\w*)\b.{0,20}\b(comando|script|shell|terminal|ssh)\b/],
  [2, 'gastar dinheiro', /\b(compr(a|e|ar|ou|ando)|pag(a|ue|ar|ou|ando)|assin(a|e|ar|ou)|contrat(a|e|ar|ou))\b.{0,30}\b(plano|api|credito|assinatura|dominio|servidor|pix|boleto|cartao)\b|\bpix\b/],
  [2, 'escrever em banco/n8n', /\b(insir\w*|inser\w*|grav\w*|escrev\w*|atualiz\w*)\b.{0,30}\b(supabase|banco|tabela|n8n|planilha)\b/],
  // Nível 1 · Faz e avisa (só coisas do próprio JARVIS)
  [1, 'anotar/lembrar/rascunho', /\b(anot\w*|lembr\w*\s+(de|que|me)|me\s+lembr\w*|salv\w*\s+(isso|essa|esta|uma\s+ideia)|rascunh\w*|diario|reindex\w*)\b/],
];

export function nivelPorRegras(texto) {
  const t = normalizar(String(texto || ''));
  const casos = REGRAS_NIVEL.filter(([, , re]) => re.test(t));
  if (!casos.length) return { nivel: 0, motivos: [] };
  const nivel = Math.max(...casos.map(c => c[0]));
  return { nivel, motivos: casos.filter(c => c[0] === nivel).map(c => c[1]) };
}

export function avisoGuarda({ nivel, motivos }) {
  if (!nivel) return '';
  const nomes = { 1: 'Nível 1 · Faz e avisa', 2: 'Nível 2 · Precisa de "sim"', 3: 'Nível 3 · Proibido' };
  return `\n\n## Guarda (decisão por regra fixa, não discuta)
Este pedido foi classificado pelas regras do PERMISSOES.md como **${nomes[nivel]}** (${motivos.join(', ')}).
O nível vale para EXECUTAR a ação. Se for só uma pergunta ou pedido de explicação, responda normalmente.
Você não tem ferramentas: não diga que fez, vai fazer ou agendou. Se pedirem para você executar, explique o nível${nivel === 3 ? ', o risco, e que só o Jean pode fazer isso ele mesmo' : ''} e, se útil, entregue o passo para o Jean executar.`;
}
