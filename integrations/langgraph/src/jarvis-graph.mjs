import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const appendTrace = (current, update) => [...(current || []), ...(update || [])];

export const JarvisState = Annotation.Root({
  input: Annotation,
  plan: Annotation,
  selectedRoute: Annotation,
  execution: Annotation,
  response: Annotation,
  attempts: Annotation({ reducer: (_current, update) => update, default: () => 0 }),
  maxAttempts: Annotation({ reducer: (_current, update) => update, default: () => 2 }),
  error: Annotation,
  trace: Annotation({ reducer: appendTrace, default: () => [] }),
});

const defaultHandlers = {
  plan: async ({ input }) => [{ id: "responder", objective: input, dependsOn: [] }],
  select: async () => ({ kind: "jarvis", id: "regras" }),
  execute: async ({ input, selectedRoute }) => ({ text: `[${selectedRoute.id}] ${input}` }),
  respond: async ({ execution, error }) => error
    ? `Não foi possível concluir: ${error}`
    : String(execution?.text || "Sem resposta."),
};

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createJarvisGraph(overrides = {}) {
  const handlers = { ...defaultHandlers, ...overrides };

  const taskPlanning = async (state) => ({
    plan: await handlers.plan(state),
    error: undefined,
    trace: ["task_planning"],
  });

  const modelSelection = async (state) => ({
    selectedRoute: await handlers.select(state),
    error: undefined,
    trace: ["model_selection"],
  });

  const taskExecution = async (state) => {
    const attempts = state.attempts + 1;
    try {
      return {
        attempts,
        execution: await handlers.execute({ ...state, attempts }),
        error: undefined,
        trace: ["task_execution"],
      };
    } catch (error) {
      return {
        attempts,
        execution: undefined,
        error: message(error),
        trace: ["task_execution_error"],
      };
    }
  };

  const responseGeneration = async (state) => ({
    response: await handlers.respond(state),
    trace: ["response_generation"],
  });

  const afterExecution = (state) => state.error && state.attempts < state.maxAttempts
    ? "modelSelection"
    : "responseGeneration";

  return new StateGraph(JarvisState)
    .addNode("taskPlanning", taskPlanning)
    .addNode("modelSelection", modelSelection)
    .addNode("taskExecution", taskExecution)
    .addNode("responseGeneration", responseGeneration)
    .addEdge(START, "taskPlanning")
    .addEdge("taskPlanning", "modelSelection")
    .addEdge("modelSelection", "taskExecution")
    .addConditionalEdges("taskExecution", afterExecution, {
      modelSelection: "modelSelection",
      responseGeneration: "responseGeneration",
    })
    .addEdge("responseGeneration", END)
    .compile({ name: "jarvis-four-stage-orchestrator" });
}

export async function runJarvisGraph(input, options = {}) {
  if (typeof input !== "string" || !input.trim()) throw new Error("input obrigatório");
  const graph = createJarvisGraph(options.handlers);
  return graph.invoke({
    input: input.trim(),
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 2,
    trace: [],
  });
}
