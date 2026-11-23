import { DEFAULT_CONFIG, normalizeJarvisUrl, permissionPattern } from "./lib/jarvis-client.mjs";

const form = document.querySelector("#settingsForm");
const urlInput = document.querySelector("#url");
const userInput = document.querySelector("#user");
const passwordInput = document.querySelector("#password");
const result = document.querySelector("#result");

async function load() {
  const saved = await chrome.storage.local.get(DEFAULT_CONFIG);
  urlInput.value = saved.url;
  userInput.value = saved.user;
  const session = await chrome.storage.session.get({ password: "" });
  passwordInput.value = session.password;
}

function show(message, error = false) {
  result.textContent = message;
  result.style.color = error ? "#ff91a1" : "#72ffc2";
}

document.querySelectorAll("[data-url]").forEach((button) => {
  button.addEventListener("click", () => {
    urlInput.value = button.dataset.url;
    userInput.value = button.dataset.user || "";
    passwordInput.focus();
  });
});

document.querySelector("#clearPassword").addEventListener("click", async () => {
  passwordInput.value = "";
  await chrome.storage.session.remove("password");
  show("Senha removida da sessão.");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const url = normalizeJarvisUrl(urlInput.value);
    const origin = permissionPattern(url);
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission && !await chrome.permissions.request({ origins: [origin] })) {
      throw new Error("Permissão para acessar esse servidor não foi concedida.");
    }
    await chrome.storage.local.set({ url, user: userInput.value.trim() });
    await chrome.storage.session.set({ password: passwordInput.value });
    const health = await chrome.runtime.sendMessage({ type: "health" });
    if (!health?.ok) throw new Error(health?.error || "Servidor não respondeu.");
    show(`Conectado: ${health.data?.modelo || "JARVIS online"}`);
  } catch (error) {
    show(error.message, true);
  }
});

load().catch((error) => show(error.message, true));
