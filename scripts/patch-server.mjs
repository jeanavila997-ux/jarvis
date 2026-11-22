// Aplica as integrações Docker MCP no server.mjs do jarvis-local. Idempotente.
import { readFile, writeFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) { console.error('uso: node patch-server.mjs <server.mjs>'); process.exit(1); }
let s = await readFile(path, 'utf8');
const orig = s;

if (!s.includes("from './src/docker-mcp.mjs'")) {
  s = s.replace(
    "import { criarClienteNvidia, criarClienteNvidiaMcp } from './src/nvidia.mjs';",
    "import { criarClienteNvidia, criarClienteNvidiaMcp } from './src/nvidia.mjs';\nimport { criarClienteDockerMcp } from './src/docker-mcp.mjs';",
  );
}

if (!s.includes('criarClienteDockerMcp(')) {
  s = s.replace(
    "  : criarClienteNvidia({ ligada: process.env.NVIDIA_APP === '1', url: process.env.NVIDIA_PROXY_URL, token: process.env.NVIDIA_PROXY_TOKEN || '' });",
    "  : criarClienteNvidia({ ligada: process.env.NVIDIA_APP === '1', url: process.env.NVIDIA_PROXY_URL, token: process.env.NVIDIA_PROXY_TOKEN || '' });\n"
    + "const dockerMcp = criarClienteDockerMcp({\n"
    + "  ligada: process.env.DOCKER_MCP === '1',\n"
    + "  url: process.env.DOCKER_MCP_URL || '',\n"
    + "  token: process.env.DOCKER_MCP_TOKEN || '',\n"
    + "});",
  );
}

s = s.replace('let snapHermes = null, snapNvidia = null;', 'let snapHermes = null, snapNvidia = null, snapGithub = null;');

if (!s.includes('dockerMcp.ativa) snapGithub')) {
  s = s.replace(
    '  if (nvidia.ativa) snapNvidia = await nvidia.saudavel();\n}',
    '  if (nvidia.ativa) snapNvidia = await nvidia.saudavel();\n  if (dockerMcp.ativa) snapGithub = await dockerMcp.saudavel();\n}',
  );
}

if (!s.includes('async function textoGithub(')) {
  const fn = `
async function textoGithub() {
  if (!dockerMcp.ativa) return 'GitHub (Docker MCP): desligado (defina DOCKER_MCP=1, DOCKER_MCP_URL e DOCKER_MCP_TOKEN).';
  const s0 = await dockerMcp.saudavel(); snapGithub = s0;
  if (!s0.ok) return \`GitHub (Docker MCP): indisponível (\${s0.motivo}). Leitura só roda se o gateway estiver no ar e autenticado.\`;
  const partes = [\`GitHub (Docker MCP) ok (leitura). Ferramentas permitidas: \${(s0.ferramentas || []).join(', ') || '—'}.\`];
  try {
    const r = await dockerMcp.chamar('get_me', {});
    const txt = r?.result?.content?.map?.(c => c.text).filter(Boolean).join('\\n') || JSON.stringify(r?.result || r);
    partes.push('get_me: ' + String(txt).slice(0, 800));
  } catch (e) { partes.push('get_me: ' + e.message); }
  partes.push('Escrita comum é nível 2 (pede "sim" no Telegram). delete_file e merge_pull_request são nível 3 e são proibidas.');
  return partes.join('\\n');
}
`;
  s = s.replace('  return partes.join(\'\\n\');\n}\nconst PUBLIC', `  return partes.join('\\n');\n}\n${fn}const PUBLIC`);
}

if (!s.includes('github: dockerMcp.ativa')) {
  s = s.replace(
    'nvidia: nvidia.ativa ? (snapNvidia || { ok: false, motivo: \'ainda-nao-medido\' }) : null,',
    'nvidia: nvidia.ativa ? (snapNvidia || { ok: false, motivo: \'ainda-nao-medido\' }) : null, github: dockerMcp.ativa ? (snapGithub || { ok: false, motivo: \'ainda-nao-medido\' }) : null,',
  );
}

s = s.replace(
  'const ctxRegras = { status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias), textoHermes, textoNvidia };',
  'const ctxRegras = { status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias), textoHermes, textoNvidia, textoGithub };',
);

if (!s.includes('statusAtual().github')) {
  s = s.replace(
    'return json(res, 200, { ok: true, versao: \'0.2.0\', modelo: MODEL, local: roteador.localLigado ? LOCAL_MODEL : null, nuvemLocal: NUVEM_LOCAL, hermes: statusAtual().hermes, nvidia: statusAtual().nvidia, reserva: reserva.ativa, notas: indice.notas, trechos: indice.chunks.length, ignorados: indice.ignorados, indexado: indice.atualizado });',
    'return json(res, 200, { ok: true, versao: \'0.2.0\', modelo: MODEL, local: roteador.localLigado ? LOCAL_MODEL : null, nuvemLocal: NUVEM_LOCAL, hermes: statusAtual().hermes, nvidia: statusAtual().nvidia, github: statusAtual().github, reserva: reserva.ativa, notas: indice.notas, trechos: indice.chunks.length, ignorados: indice.ignorados, indexado: indice.atualizado });',
  );
}

if (!s.includes("/api/github")) {
  s = s.replace(
    "    if (p === '/api/nvidia' && req.method === 'GET') return json(res, 200, { texto: await textoNvidia(), snap: snapNvidia });",
    "    if (p === '/api/nvidia' && req.method === 'GET') return json(res, 200, { texto: await textoNvidia(), snap: snapNvidia });\n    if (p === '/api/github' && req.method === 'GET') return json(res, 200, { texto: await textoGithub(), snap: snapGithub });",
  );
}

s = s.replace(
  "console.log(`[jarvis] ouvindo em ${HOST}:${PORT} · principal ${MODEL} via ${OLLAMA_URL} · local ${roteador.localLigado ? LOCAL_MODEL : 'desligado'} · hermes ${hermes.ativa ? 'ligado' : 'off'} · nvidia ${nvidia.ativa ? 'ligado' : 'off'}`);",
  "console.log(`[jarvis] ouvindo em ${HOST}:${PORT} · principal ${MODEL} via ${OLLAMA_URL} · local ${roteador.localLigado ? LOCAL_MODEL : 'desligado'} · hermes ${hermes.ativa ? 'ligado' : 'off'} · nvidia ${nvidia.ativa ? 'ligado' : 'off'} · github ${dockerMcp.ativa ? 'ligado' : 'off'}`);",
);

s = s.replace(
  '  status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias),\n  hermes, nvidia, textoHermes, textoNvidia,\n});',
  '  status: statusAtual, resumo: dias => resumoUso(DATA_DIR, dias),\n  hermes, nvidia, textoHermes, textoNvidia, textoGithub,\n});',
);

s = s.replace(
  'nvidia?.fechar?.().catch(() => {}); server.close(() => process.exit(0));',
  'nvidia?.fechar?.().catch(() => {}); dockerMcp?.fechar?.().catch(() => {}); server.close(() => process.exit(0));',
);

if (s === orig) {
  console.log('server.mjs já estava patchado ou nenhum trecho bateu');
} else {
  await writeFile(path, s);
  console.log('server.mjs atualizado');
}

const checks = [
  "from './src/docker-mcp.mjs'",
  'criarClienteDockerMcp(',
  'textoGithub',
  '/api/github',
  'github: dockerMcp.ativa',
  'statusAtual().github',
];
for (const c of checks) {
  if (!s.includes(c)) { console.error('FALHOU check:', c); process.exit(2); }
}
console.log('checks ok');
