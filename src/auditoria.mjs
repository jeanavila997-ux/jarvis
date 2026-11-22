// Registro de auditoria: só acrescenta (JSONL). Nunca grava segredos nem conteúdo de mensagens de terceiros.
import { appendFile } from 'node:fs/promises';
import path from 'node:path';

const MASCARA = /(bot\d+:[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,})/g;
export async function auditar(dataDir, evento) {
  const ts = new Date().toLocaleString('sv-SE', { timeZone: 'America/Rio_Branco' }).replace(' ', 'T') + '-05:00';
  const linha = JSON.stringify({ ts, ...evento }).replace(MASCARA, '***');
  try { await appendFile(path.join(dataDir, 'auditoria.jsonl'), linha + '\n'); }
  catch (e) { console.error('[auditoria] falha ao gravar:', e.message); }
}
