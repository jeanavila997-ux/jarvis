const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const prompt = document.querySelector("#prompt");
const send = document.querySelector("#send");
const status = document.querySelector("#status");
let conversationId = "";
let activeAssistant = null;
let port = null;

function addMessage(kind, text = "") {
  const item = document.createElement("article");
  item.className = kind;
  item.textContent = text;
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return item;
}

function setBusy(value) {
  send.disabled = value;
  prompt.disabled = value;
  send.textContent = value ? "…" : "Enviar";
}

function connect() {
  port = chrome.runtime.connect({ name: "jarvis-chat" });
  port.onMessage.addListener((message) => {
    if (message.type === "event") {
      const event = message.event || {};
      if (event.tipo === "inicio" && event.conversaId) conversationId = event.conversaId;
      if (event.tipo === "pensando" && activeAssistant && !activeAssistant.textContent) activeAssistant.textContent = "Pensando…";
      if (event.tipo === "delta" && activeAssistant) {
        if (activeAssistant.textContent === "Pensando…") activeAssistant.textContent = "";
        activeAssistant.textContent += event.texto || "";
        messages.scrollTop = messages.scrollHeight;
      }
      if (event.tipo === "erro") addMessage("error", event.mensagem || "Erro do JARVIS.");
    }
    if (message.type === "error") {
      if (activeAssistant && !activeAssistant.textContent) activeAssistant.remove();
      addMessage("error", message.error || "Não foi possível falar com o JARVIS.");
      setBusy(false);
    }
    if (message.type === "complete") {
      if (activeAssistant && !activeAssistant.textContent) activeAssistant.textContent = "Sem resposta.";
      setBusy(false);
      prompt.focus();
    }
  });
}

function submitText(text) {
  const clean = String(text || "").trim();
  if (!clean || send.disabled) return;
  addMessage("user", clean);
  activeAssistant = addMessage("assistant", "");
  setBusy(true);
  if (!port) connect();
  port.postMessage({ type: "chat", text: clean, conversationId });
  prompt.value = "";
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitText(prompt.value);
});
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
});
document.querySelectorAll("[data-command]").forEach((button) => {
  button.addEventListener("click", () => submitText(button.dataset.command));
});
document.querySelector("#settings").addEventListener("click", () => chrome.runtime.sendMessage({ type: "open-options" }));

chrome.runtime.sendMessage({ type: "health" }, (result) => {
  if (chrome.runtime.lastError || !result?.ok) {
    status.textContent = "Desconectado";
    status.style.color = "#ff8b9d";
    return;
  }
  const model = result.data?.modelo ? ` · ${result.data.modelo}` : "";
  status.textContent = `Online${model}`;
  status.style.color = "#6fffc4";
});

prompt.focus();
