import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildHeaders, normalizeJarvisUrl, parseNdjsonChunk, permissionPattern } from "../browser-extension/lib/jarvis-client.mjs";

test("extensão aceita localhost HTTP e exige HTTPS remoto", () => {
  assert.equal(normalizeJarvisUrl("http://127.0.0.1:3200/"), "http://127.0.0.1:3200");
  assert.equal(normalizeJarvisUrl("https://jarvis.example/api/"), "https://jarvis.example/api");
  assert.equal(permissionPattern("https://jarvis.example/api"), "https://jarvis.example/*");
  assert.throws(() => normalizeJarvisUrl("http://jarvis.example"), /HTTPS/);
  assert.throws(() => normalizeJarvisUrl("https://jean:senha@jarvis.example"), /senha na URL/);
  assert.throws(() => normalizeJarvisUrl("file:///etc/passwd"), /HTTPS/);
});

test("cabeçalhos incluem protocolo JARVIS e Basic Auth somente quando configurado", () => {
  assert.deepEqual(buildHeaders(), { Accept: "application/x-ndjson", "X-Jarvis": "1" });
  const headers = buildHeaders("jean", "segredo", true);
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers.Authorization, `Basic ${Buffer.from("jean:segredo").toString("base64")}`);
});

test("parser NDJSON preserva linha parcial entre chunks", () => {
  const first = parseNdjsonChunk("", '{"tipo":"delta","texto":"Oi"}\n{"tipo":"del');
  assert.deepEqual(first.events, [{ tipo: "delta", texto: "Oi" }]);
  const second = parseNdjsonChunk(first.rest, 'ta","texto":"!"}\n');
  assert.deepEqual(second.events, [{ tipo: "delta", texto: "!" }]);
  assert.equal(second.rest, "");
});

test("manifesto MV3 não solicita acesso a abas, cookies ou histórico", async () => {
  const manifest = JSON.parse(await readFile(new URL("../browser-extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("storage"));
  for (const forbidden of ["tabs", "history", "cookies", "downloads", "webRequest"]) {
    assert.equal(manifest.permissions.includes(forbidden), false);
  }
});
