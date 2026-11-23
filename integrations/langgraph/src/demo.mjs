import { runJarvisGraph } from "./jarvis-graph.mjs";

const input = process.argv.slice(2).join(" ").trim() || "status curto do JARVIS";
const result = await runJarvisGraph(input);
console.log(JSON.stringify({ response: result.response, trace: result.trace }, null, 2));
