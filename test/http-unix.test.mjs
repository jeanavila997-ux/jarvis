import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ehUnix, caminhoSocket, exigeChaveOllama, opcoesChatLocal, fetchUrl } from '../src/http-unix.mjs';
import { chatOllama } from '../src/llm.mjs';

test('exigeChaveOllama: local e unix não exigem; nuvem exige', () => {
  assert.equal(exigeChaveOllama('unix:///app/run/ollama.sock'), false);
  assert.equal(exigeChaveOllama('http://127.0.0.1:11434'), false);
  assert.equal(exigeChaveOllama('http://host.docker.internal:11434'), false);
  assert.equal(exigeChaveOllama('http://ollama:11434'), false);
  assert.equal(exigeChaveOllama('http://172.16.5.1:11434'), false);
  assert.equal(exigeChaveOllama('https://ollama.com'), true);
  assert.equal(exigeChaveOllama('https://api.ollama.com'), true);
  const curta = opcoesChatLocal({ curto: true, think: false, numCtx: 2048 });
  assert.equal(curta.think, false);
  assert.equal(curta.options.num_ctx, 2048);
  assert.equal(curta.options.num_predict, 300);
  const completa = opcoesChatLocal({ curto: false, think: false, numCtx: 2048 });
  assert.equal(completa.options.num_predict, undefined);
  assert.equal(opcoesChatLocal({ numCtx: 'nope' }).options.num_ctx, 4096);
  assert.equal(ehUnix('unix:///app/run/ollama.sock'), true);
  assert.equal(caminhoSocket('unix:///app/run/ollama.sock'), '/app/run/ollama.sock');
});

test('fetchUrl e chatOllama falam HTTP por Unix socket', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sock-'));
  const sock = path.join(dir, 'ollama.sock');
  const server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      let b = '';
      req.on('data', c => b += c);
      req.on('end', () => {
        const j = JSON.parse(b);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content: `ok:${j.model}` }, prompt_eval_count: 1, eval_count: 2 }));
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve, reject) => server.listen(sock, err => err ? reject(err) : resolve()));
  try {
    const r = await fetchUrl('unix://' + sock, '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'x' }) });
    assert.equal(r.status, 200);
    const chat = await chatOllama({ url: 'unix://' + sock, model: 'llama-teste', stream: false, nome: 'Ollama local' });
    assert.equal(chat.resposta, 'ok:llama-teste');
    assert.equal(chat.tokensIn, 1);
  } finally {
    await new Promise(r => server.close(r));
    try { fs.unlinkSync(sock); } catch {}
    try { fs.rmdirSync(dir); } catch {}
  }
});
