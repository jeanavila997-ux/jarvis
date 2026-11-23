import test from "node:test";
import assert from "node:assert/strict";
import { runJarvisGraph } from "../src/jarvis-graph.mjs";

test("executa os quatro estágios em ordem", async () => {
  const result = await runJarvisGraph("verificar saúde");
  assert.equal(result.response, "[regras] verificar saúde");
  assert.deepEqual(result.trace, [
    "task_planning",
    "model_selection",
    "task_execution",
    "response_generation",
  ]);
  assert.equal(result.attempts, 1);
});

test("repete seleção e execução depois de falha transitória", async () => {
  let calls = 0;
  const result = await runJarvisGraph("tarefa", {
    maxAttempts: 2,
    handlers: {
      select: async () => ({ kind: "model", id: calls ? "reserva" : "principal" }),
      execute: async () => {
        calls += 1;
        if (calls === 1) throw new Error("modelo indisponível");
        return { text: "concluído pela reserva" };
      },
    },
  });
  assert.equal(result.response, "concluído pela reserva");
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.trace, [
    "task_planning",
    "model_selection",
    "task_execution_error",
    "model_selection",
    "task_execution",
    "response_generation",
  ]);
});

test("encerra com erro controlado ao esgotar tentativas", async () => {
  const result = await runJarvisGraph("tarefa", {
    maxAttempts: 2,
    handlers: { execute: async () => { throw new Error("offline"); } },
  });
  assert.equal(result.response, "Não foi possível concluir: offline");
  assert.equal(result.attempts, 2);
});

test("recusa entrada vazia", async () => {
  await assert.rejects(() => runJarvisGraph("  "), /input obrigatório/);
});
