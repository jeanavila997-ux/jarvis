import { DEFAULT_CONFIG, buildHeaders, normalizeJarvisUrl, readNdjson } from "./lib/jarvis-client.mjs";

async function getConnection() {
  const saved = await chrome.storage.local.get(DEFAULT_CONFIG);
  const session = await chrome.storage.session.get({ password: "" });
  return { url: normalizeJarvisUrl(saved.url), user: saved.user || "", password: session.password || "" };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULT_CONFIG).then((saved) => chrome.storage.local.set(saved));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "open-options") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "health") {
    getConnection()
      .then(async ({ url, user, password }) => {
        const response = await fetch(url + "/api/saude", { headers: buildHeaders(user, password) });
        if (!response.ok) throw new Error(`JARVIS HTTP ${response.status}`);
        sendResponse({ ok: true, data: await response.json() });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jarvis-chat") return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message) => {
    if (message?.type !== "chat") return;
    try {
      const { url, user, password } = await getConnection();
      const body = { mensagem: String(message.text || "").trim() };
      if (!body.mensagem) throw new Error("Digite uma mensagem.");
      if (message.conversationId) body.conversaId = message.conversationId;
      const response = await fetch(url + "/api/chat", {
        method: "POST",
        headers: buildHeaders(user, password, true),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      await readNdjson(response, (event) => port.postMessage({ type: "event", event }));
      port.postMessage({ type: "complete" });
    } catch (error) {
      if (error.name !== "AbortError") port.postMessage({ type: "error", error: error.message });
    }
  });
});
