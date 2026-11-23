export const DEFAULT_CONFIG = Object.freeze({
  url: "http://127.0.0.1:3200",
  user: "",
});

export function normalizeJarvisUrl(value) {
  let url;
  try { url = new URL(String(value || "").trim()); } catch { throw new Error("URL do JARVIS inválida."); }
  if (url.username || url.password) throw new Error("Não coloque usuário ou senha na URL.");
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Use HTTPS; HTTP é permitido somente em localhost.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function permissionPattern(baseUrl) {
  const url = new URL(normalizeJarvisUrl(baseUrl));
  return `${url.origin}/*`;
}

export function buildHeaders(user = "", password = "", withBody = false) {
  const headers = { Accept: "application/x-ndjson", "X-Jarvis": "1" };
  if (withBody) headers["Content-Type"] = "application/json";
  if (user || password) headers.Authorization = "Basic " + btoa(unescape(encodeURIComponent(`${user}:${password}`)));
  return headers;
}

export function parseNdjsonChunk(buffer, chunk) {
  const lines = (buffer + chunk).split(/\r?\n/);
  return {
    rest: lines.pop() || "",
    events: lines.filter((line) => line.trim()).map((line) => JSON.parse(line)),
  };
}

export async function readNdjson(response, onEvent) {
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`JARVIS HTTP ${response.status}: ${detail || response.statusText}`);
  }
  if (!response.body) throw new Error("Resposta do JARVIS sem fluxo de dados.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const parsed = parseNdjsonChunk(buffer, decoder.decode(value, { stream: true }));
    buffer = parsed.rest;
    for (const event of parsed.events) onEvent(event);
  }
  const tail = (buffer + decoder.decode()).trim();
  if (tail) onEvent(JSON.parse(tail));
}
