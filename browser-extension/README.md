# Extensão JARVIS para Chrome e Edge

Extensão Manifest V3, sem dependências e com o mesmo pacote para Google Chrome e Microsoft Edge.

## Instalar

1. Abra `chrome://extensions` no Chrome ou `edge://extensions` no Edge.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `browser-extension`.
4. Abra **Detalhes → Opções da extensão** e escolha **PC local** ou **VPS do Jean**.
5. Na VPS, informe a senha. Ela fica em `chrome.storage.session`, não em arquivo nem no Git.

## Permissões e segurança

- Não usa content script e não pede acesso a abas, histórico, cookies ou downloads.
- Tem acesso fixo apenas ao JARVIS local e à VPS conhecida. Outro servidor exige permissão explícita.
- Rejeita HTTP remoto; somente localhost pode usar HTTP.
- O chat envia `X-Jarvis: 1` e interpreta o NDJSON de `POST /api/chat`.
- Os níveis de autorização permanecem no JARVIS: ações de nível 2 aguardam confirmação e nível 3 não é liberado pela extensão.

## Estrutura

- `background.js`: autenticação e streaming de rede.
- `popup.*`: conversa e atalhos Saúde, Hermes e Mestre.
- `options.*`: configuração segura local/VPS.
- `lib/jarvis-client.mjs`: validação, cabeçalhos e parser NDJSON testáveis.
