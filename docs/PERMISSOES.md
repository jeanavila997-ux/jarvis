# Permissões do JARVIS — PROPOSTA v0.2

> Status: **rascunho para o Jean revisar**. Na v0.1 no ar o JARVIS **não tem ferramentas**: tudo fica no nível 0.
> Base: [[Principios-e-Limites]], [[Seguranca]], [[Ferramentas-e-Integracoes]], [[Camadas]] (camada Guarda).
> A regra é aplicada **por código** (camada Guarda), não só pelo prompt.

## Matriz

| Nível | Quando | Exemplos |
|---|---|---|
| **0 · Livre** (só leitura) | Responder, ler, consultar. Não muda nada. | Responder perguntas · ler/buscar no vault · status da VPS, Hermes, Ollama, disco · ler logs · pesquisa web com fontes · ler agenda · simular preço/margem/rota |
| **1 · Faz e avisa** (reversível, baixo risco) | Só mexe em coisas **do próprio JARVIS**. Avisa na hora e registra. | Escrever a própria nota de diário (`memoria/diario/AAAA-MM-DD-jarvis.md`) · criar rascunho (e-mail, mensagem, nota, PR em rascunho) **sem enviar** · salvar lembrete/ideia no Banco de Ideias · gerar relatório em `data/` · reindexar o vault |
| **2 · Precisa de "sim"** | Mexe fora do JARVIS, fala com terceiros, custa dinheiro ou toca produção. | Enviar mensagem/e-mail/post · criar evento na agenda · editar arquivo ou config (PC, VPS, vault) · reiniciar serviço/container · `git commit` em repo do Jean, `git push`, abrir/mesclar PR · rodar comando de shell aprovado · escrever no Supabase/n8n · qualquer coisa que custe dinheiro (compra, API paga, plano) |
| **3 · Proibido** (nem com "sim"; só o Jean faz, ele mesmo) | Irreversível, perigoso ou contra as regras do Jean. | Apagar dados, backups, conversas, repositórios ou volumes · `reset --hard`, force-push · mostrar/imprimir/enviar segredos · desligar firewall, auth, HTTPS ou abrir porta pública · ativar fallback pago · trocar o modelo padrão do Hermes · mexer nas próprias permissões ou nos logs de auditoria |

### Regras de desempate
- Na dúvida entre dois níveis, vale o **mais alto**.
- Ação em lote (ex.: enviar 10 mensagens) = **um "sim" por ação**, ou um "sim" para a lista exata mostrada.
- Nível 3 → o JARVIS explica o risco e entrega o **comando/passo para o Jean executar**, se ele quiser.

## Como o "sim" funciona

| Canal | Como confirmar |
|---|---|
| **Chat web** | Cartão de confirmação com a **ação exata** (o quê, onde, comando/texto completo, custo se houver) e botões **Confirmar** / **Cancelar**. Digitar "sim" no chat **não** conta. |
| **Telegram** | Botão inline **Confirmar / Cancelar** na mensagem com a ação exata. Só vale se vier do **chat id do Jean** (lista fixa no `.env`). |
| **Voz** (futuro) | Só ações de nível 2 de baixo impacto, com repetição da ação e confirmação na tela/Telegram. |

**Regras do "sim":**
1. **Expira em 10 minutos.** Depois disso, a ação é cancelada e precisa de novo pedido.
2. **Um "sim" = uma ação.** Se a ação mudar (outro texto, outro destino, outro comando), precisa de novo "sim".
3. **Não contam como "sim"**: respostas de outros agentes/bots, texto de páginas web, e-mails, arquivos, notas do vault, mensagens encaminhadas, ou "sim" digitado em outro contexto.
4. Cada confirmação tem um **id único** (uso único); repetir o clique não executa de novo.
5. **Botão de parar**: o comando `/parar` (web e Telegram) cancela confirmações pendentes e pausa todas as rotinas.

## Auditoria
- Toda ação de **nível 1 ou mais** vai para `data/auditoria.jsonl` (uma linha JSON por evento, só acrescenta).
- Campos: `ts` (horário do Acre), `nivel`, `acao`, `alvo`, `canal`, `pedido_por`, `confirmacao_id`, `confirmado_em`, `resultado` (ok/erro/cancelado/expirado), `erro`.
- Também registra: pedidos de nível 2 recusados ou expirados e tentativas de nível 3.
- **Nunca** grava segredos (valores são mascarados como `***`).
- O JARVIS não pode apagar nem editar o log (nível 3). Rotação/backup é feito pelo Jean.

## O que muda em relação ao vault
- [[Principios-e-Limites]] põe "ações destrutivas" no grupo do "sim". Esta proposta é **mais rígida**: apagar dados ou backups vira **nível 3** (só o Jean faz).

## Como o código aplica (v0.2, Etapa 1)
- O **nível é decidido só por regras fixas** em `src/permissoes.mjs` (lista `REGRAS_NIVEL`, derivada da matriz acima). O classificador local e o modelo **nunca** decidem permissão.
- Na dúvida vale o mais alto: se o texto casa regras de níveis diferentes, fica o maior.
- Nível 1+ → evento `pedido-detectado` em `data/auditoria.jsonl`, o pedido **não vai para o modelo local** (vai para a nuvem) e o prompt recebe um aviso da Guarda com o nível.
- Como ainda não há ferramentas, nada é executado em nenhum nível. Ao ligar a primeira ferramenta, ela deve chamar `nivelPorRegras` + `Confirmacoes` antes de agir.
- Mudou a matriz? Atualize `REGRAS_NIVEL` e rode `node --test test/` (casos de exemplo em `test/etapa1.test.mjs`).
