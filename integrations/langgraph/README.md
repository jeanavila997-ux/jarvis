# LangGraph no JARVIS

Integração isolada para experimentar o LangGraph sem adicionar dependências ao núcleo zero-dependency do JARVIS.

## Instalação

```sh
cd integrations/langgraph
npm ci
npm test
npm start -- "status curto do JARVIS"
```

As versões são fixas e o `package-lock.json` deve ser mantido no Git.

## Grafo inicial

1. `taskPlanning`: cria o plano estruturado.
2. `modelSelection`: escolhe modelo, agente ou ferramenta.
3. `taskExecution`: executa e registra falhas.
4. `responseGeneration`: consolida o resultado.

Quando a execução falha, o grafo volta à seleção de modelo até `maxAttempts`. Os handlers são injetáveis, permitindo conectar gradualmente o roteador, o Mestre MCP e o Hermes sem acoplar o framework ao servidor principal.

## Segurança

- Nenhum segredo fica no estado de exemplo.
- O módulo não executa shell nem comandos administrativos.
- Confirmações e níveis de autorização continuam sob responsabilidade do núcleo do JARVIS.
- A instalação fica confinada a esta pasta e pode ser removida sem alterar o servidor principal.
