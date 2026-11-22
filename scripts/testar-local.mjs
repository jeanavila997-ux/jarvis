// Teste ao vivo do classificador + modelo local (não chama a nuvem).
// Uso (na VPS, container temporário com acesso ao Ollama local):
//   docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges:true -u 1000:1000 \
//     -v /opt/apps/jarvis:/app:ro -w /app node:22.23.5-alpine node scripts/testar-local.mjs http://127.0.0.1:11434 llama3.2:3b
import { classificar } from '../src/classificador.mjs';
import { criarRoteador } from '../src/roteador.mjs';
import { nivelPorRegras } from '../src/permissoes.mjs';
const [url = 'http://127.0.0.1:11434', model = 'llama3.2:3b'] = process.argv.slice(2);
const r = criarRoteador({ localUrl: url, localModel: model, classificar: t => classificar(t, { url, model, timeoutMs: 90000 }) });
const perguntas = ['oi jarvis, bom dia', 'obrigado!', 'que horas são no acre?', 'o que é o hermes?', 'qual o preço do boi gordo hoje?',
  'qual a margem ideal pra vender sal mineral no acre considerando frete?', 'escreve um script python que lê um csv e gera relatório',
  'me explica a arquitetura do jarvis e as etapas do plano', 'reinicia o container do n8n', 'apaga os backups antigos'];
for (const p of perguntas) {
  const t0 = Date.now(); const d = await r.decidir(p, nivelPorRegras(p));
  console.log(`${String(Date.now() - t0).padStart(6)}ms  rota=${d.rota.padEnd(6)} nota=${d.nota ?? '-'} tipo=${(d.tipo ?? '-').padEnd(16)} nivel=${d.nivel} motivo=${d.motivo}  | ${p}`);
}
