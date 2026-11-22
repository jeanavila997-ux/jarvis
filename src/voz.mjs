// Cliente do Voicebox (TTS). API sem autenticação: só loopback ou Unix socket.
// Prefere o PC (acelerador GPU) quando VOICEBOX_PC_URL estiver saudável; senão a VPS (CPU).
// Fila de 1 geração por vez. Nunca loga chaves. Desligado por padrão (VOICEBOX=0).
import { spawn } from 'node:child_process';
import { fetchUrl } from './http-unix.mjs';
import { normalizar } from './retrieval.mjs';

const TEXTO_MAX = 800;
const PERFIL_NOME = 'JARVIS Dora PT';
const VOZ_PRESET = 'pf_dora';

export function criarClienteVoz({
  ligada = false,
  url = '',
  urlPc = '',
  profileId = '',
  language = 'pt',
  engine = 'kokoro',
  timeoutMs = 180000,
  cacheMs = 15000,
  ffmpegBin = 'ffmpeg',
  agora = () => Date.now(),
  fetchFn = null,
  spawnFn = spawn,
} = {}) {
  const vps = String(url || '').trim().replace(/\/$/, '');
  const pc = String(urlPc || '').trim().replace(/\/$/, '');
  const ativa = Boolean(ligada && (vps || pc));
  const idioma = String(language || 'pt');
  const motor = String(engine || 'kokoro');
  const perfilFixo = String(profileId || '').trim();
  const perfis = new Map(); // base -> profile_id
  let saudeCache = { ate: 0, valor: null };
  let fila = Promise.resolve();

  function enfileirar(fn) {
    const p = fila.then(fn, fn);
    fila = p.then(() => {}, () => {});
    return p;
  }

  async function pedido(base, path, { method = 'GET', body, timeout = timeoutMs, headers = {} } = {}) {
    if (!base) throw new Error('voicebox: URL vazia');
    const c = new AbortController();
    const tm = setTimeout(() => c.abort(), timeout);
    try {
      const opts = { method, headers: { accept: '*/*', ...headers }, signal: c.signal };
      if (body !== undefined) {
        opts.headers['content-type'] = 'application/json';
        opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const r = fetchFn
        ? await fetchFn(base, path, opts)
        : await fetchUrl(base, path, opts);
      return r;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('voicebox: tempo esgotado');
      throw e;
    } finally { clearTimeout(tm); }
  }

  async function ping(base, timeout = 4000) {
    try {
      const r = await pedido(base, '/health', { timeout });
      if (!r.ok) return { ok: false, motivo: `http-${r.status}`, base };
      let json = null;
      try { json = await r.json(); } catch { json = null; }
      return { ok: true, motivo: 'ok', base, bruto: json };
    } catch (e) {
      return { ok: false, motivo: e.message === 'voicebox: tempo esgotado' ? 'tempo-esgotado' : 'indisponivel', base };
    }
  }

  async function escolher() {
    if (pc) {
      const s = await ping(pc);
      if (s.ok) return { alvo: 'pc', ...s };
    }
    if (vps) {
      const s = await ping(vps);
      if (s.ok) return { alvo: 'vps', ...s };
    }
    return { ok: false, alvo: null, motivo: pc && vps ? 'pc-e-vps-indisponiveis' : 'indisponivel' };
  }

  async function saudavel() {
    if (!ativa) return { ok: false, motivo: 'desligado', alvo: null };
    const t = agora();
    if (t < saudeCache.ate) return saudeCache.valor;
    const valor = await escolher();
    saudeCache = { ate: t + cacheMs, valor };
    return valor;
  }

  async function garantirPerfil(base) {
    if (perfilFixo) return perfilFixo;
    if (perfis.has(base)) return perfis.get(base);
    const r = await pedido(base, '/profiles', { timeout: 8000 });
    if (!r.ok) throw new Error(`voicebox: listar perfis HTTP ${r.status}`);
    const lista = await r.json();
    const arr = Array.isArray(lista) ? lista : (lista?.profiles || lista?.items || []);
    const achado = arr.find(p => p?.preset_voice_id === VOZ_PRESET || p?.name === PERFIL_NOME);
    if (achado?.id) { perfis.set(base, achado.id); return achado.id; }
    const cri = await pedido(base, '/profiles', {
      method: 'POST',
      timeout: 8000,
      body: {
        name: PERFIL_NOME,
        language: idioma,
        voice_type: 'preset',
        preset_engine: motor,
        preset_voice_id: VOZ_PRESET,
        default_engine: motor,
        description: 'Voz padrão pt-BR do JARVIS (Kokoro Dora).',
      },
    });
    if (!cri.ok) throw new Error(`voicebox: criar perfil HTTP ${cri.status}`);
    const j = await cri.json();
    if (!j?.id) throw new Error('voicebox: perfil sem id');
    perfis.set(base, j.id);
    return j.id;
  }

  async function paraOgg(wav) {
    const bin = ffmpegBin || 'ffmpeg';
    return new Promise((resolve, reject) => {
      const p = spawnFn(bin, ['-hide_banner', '-loglevel', 'error', '-y', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on', '-application', 'voip', '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] });
      const out = [], err = [];
      p.stdout.on('data', c => out.push(c));
      p.stderr.on('data', c => err.push(c));
      p.on('error', e => reject(new Error(`voicebox: ffmpeg indisponível (${e.message})`)));
      p.on('close', code => {
        if (code !== 0) return reject(new Error(`voicebox: ffmpeg saiu ${code}: ${Buffer.concat(err).toString('utf8').slice(0, 200)}`));
        const ogg = Buffer.concat(out);
        if (!ogg.length) return reject(new Error('voicebox: ffmpeg gerou áudio vazio'));
        resolve(ogg);
      });
      p.stdin.on('error', () => {});
      p.stdin.end(wav);
    });
  }

  async function gerarBruto(texto) {
    if (!ativa) throw new Error('voicebox: desligado (VOICEBOX=0)');
    const t = String(texto || '').trim();
    if (!t) throw new Error('voicebox: texto vazio');
    const clip = t.length > TEXTO_MAX ? t.slice(0, TEXTO_MAX).replace(/\s+\S*$/, '') : t;
    const t0 = agora();
    const dest = await escolher();
    if (!dest.ok) throw new Error(`voicebox: nenhum backend saudável (${dest.motivo})`);
    const profile = await garantirPerfil(dest.base);
    const corpo = { profile_id: profile, text: clip, language: idioma, engine: motor, normalize: true };
    // /generate/stream é mais rápido, mas exige o modelo já baixado.
    // /generate dispara o download na primeira vez; depois buscamos o WAV em /audio/{id}.
    let buf = null;
    const stream = await pedido(dest.base, '/generate/stream', { method: 'POST', body: corpo });
    if (stream.ok) {
      buf = Buffer.from(await stream.arrayBuffer());
    } else {
      const detalhe = await stream.text().catch(() => '');
      const r = await pedido(dest.base, '/generate', { method: 'POST', body: corpo });
      if (!r.ok) {
        const d2 = await r.text().catch(() => '');
        throw new Error(`voicebox: gerar HTTP ${r.status}: ${String(d2 || detalhe).slice(0, 200)}`);
      }
      const meta = await r.json();
      const id = meta?.id;
      if (!id) throw new Error('voicebox: geração sem id');
      const limite = t0 + timeoutMs;
      let status = meta.status || 'generating';
      while (agora() < limite) {
        if (status === 'completed') break;
        if (status === 'failed') throw new Error(`voicebox: geração falhou (${meta.error || 'sem detalhe'})`);
        await new Promise(res => setTimeout(res, 1000));
        const h = await pedido(dest.base, `/history/${encodeURIComponent(id)}`, { timeout: 8000 });
        if (!h.ok) throw new Error(`voicebox: status HTTP ${h.status}`);
        Object.assign(meta, await h.json());
        status = meta.status || status;
      }
      if (status !== 'completed') throw new Error('voicebox: tempo esgotado');
      const audio = await pedido(dest.base, `/audio/${encodeURIComponent(id)}`);
      if (!audio.ok) throw new Error(`voicebox: áudio HTTP ${audio.status}`);
      buf = Buffer.from(await audio.arrayBuffer());
    }
    if (!buf?.length) throw new Error('voicebox: áudio vazio');
    const ogg = await paraOgg(buf);
    return { ogg, wav: buf, alvo: dest.alvo, ms: agora() - t0, caracteres: clip.length };
  }

  function gerar(texto) { return enfileirar(() => gerarBruto(texto)); }

  return {
    ativa,
    saudavel,
    gerar,
    // exposto para testes
    _escolher: escolher,
    _enfileirar: enfileirar,
  };
}

export function interpretarPedidoVoz(texto) {
  const original = String(texto || '').trim();
  const t = normalizar(original).replace(/@\w+/, '');
  if (!t) return null;
  if (/^\/voz\b/.test(t)) {
    const rest = original.replace(/^\/voz(@\w+)?/i, '').trim();
    if (!rest || /^(status|saude)$/i.test(rest)) return { acao: 'status', rotulo: 'status do Voicebox' };
    if (/^(ligar|ativar|on|audio|voz)$/i.test(rest)) return { acao: 'ligar', rotulo: 'responder em áudio' };
    if (/^(desligar|desativar|off|texto)$/i.test(rest)) return { acao: 'desligar', rotulo: 'voltar ao texto' };
    return { acao: 'falar', texto: rest, rotulo: 'gerar áudio' };
  }
  if (/^(responder em audio|fale em audio|fala em audio|responda em audio|modo (audio|voz)|em voz)$/.test(t)) {
    return { acao: 'ligar', rotulo: 'responder em áudio' };
  }
  if (/^(responder em texto|so texto|modo texto|sem audio|sem voz)$/.test(t)) {
    return { acao: 'desligar', rotulo: 'voltar ao texto' };
  }
  return null;
}

export function textoVozStatus(s, { ligada = false, modoConversa = false } = {}) {
  if (!ligada) return 'Voicebox: desligado (VOICEBOX=0). Para ligar, defina VOICEBOX=1 no .env (com backup).';
  if (!s?.ok) return `Voicebox: indisponível (${s?.motivo || 'sem detalhe'}).`;
  const onde = s.alvo === 'pc' ? 'PC (acelerador)' : s.alvo === 'vps' ? 'VPS (CPU)' : s.alvo || '?';
  const modo = modoConversa ? 'Neste chat, as respostas também saem em áudio.' : 'Neste chat, só texto (use /voz <frase> ou "responder em áudio").';
  return `Voicebox no ar pelo ${onde}. Motor Kokoro, voz Dora (pt-BR). ${modo}`;
}
