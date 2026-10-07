# Ambiente: instalação, execução e deploy

## Requisitos

| Ferramenta | Versão | Para quê |
| --- | --- | --- |
| Node.js | 22 ou superior | Rodar o servidor e as ferramentas de build |
| npm | 10 ou superior (vem com o Node) | Instalar dependências e rodar scripts |
| Docker Desktop / Docker Engine | 24+ com Compose v2 | Opcional, para rodar em container |

Confira com `node -v`, `npm -v` e `docker --version`.

## Instalação

Na pasta do projeto:

```bash
npm install
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Sobe o servidor em **modo desenvolvimento** na porta 8787 (veja abaixo) |
| `npm run build` | Checa os tipos (`tsc`) e gera o cliente otimizado em `dist/` |
| `npm start` | Sobe o servidor em **modo produção**, servindo os arquivos de `dist/` (rode `npm run build` antes) |
| `npm run typecheck` | Só checa os tipos do cliente e do servidor, sem gerar nada |

### Modo desenvolvimento (`npm run dev`)

- Um único processo, uma única porta (8787): o servidor do jogo (HTTP + WebSocket) e o Vite embutido, que serve o cliente.
- Mudanças no código do cliente aparecem no navegador sem recarregar a página (hot reload).
- Mudanças em `server/` ou no código compartilhado (`src/game.ts`, `src/physics.ts`, `src/stadium.ts`, `src/net/`) **reiniciam o servidor**, porque ele roda com `tsx watch`. As salas abertas são perdidas e os jogadores precisam recarregar a página.
- Pare com **Ctrl+C**.

### Modo produção (`npm start`)

- Serve os arquivos estáticos de `dist/`. Qualquer rota desconhecida devolve o `index.html`.
- Precisa de um `npm run build` feito antes. Sem ele, a página mostra uma mensagem pedindo o build.
- O modo é ativado pela flag `--prod` (já incluída no script).

## Configuração

| Variável | Padrão | Onde | Descrição |
| --- | --- | --- | --- |
| `PORT` | `8787` | Servidor | Porta HTTP/WebSocket em que o servidor escuta |
| `HOST_PORT` | `8787` | `compose.yaml` | Porta do seu computador ligada ao container |
| `BIND_ADDRESS` | `0.0.0.0` | `compose.yaml` | Interface onde a porta é publicada. Use `127.0.0.1` atrás de um nginx (veja [deploy-vps.md](deploy-vps.md)) |

O servidor escuta em todas as interfaces de rede, então outras máquinas da rede também conseguem acessar. Exemplo trocando a porta:

```bash
# PowerShell
$env:PORT = "3000"; npm run dev

# bash
PORT=3000 npm run dev
```

As regras do jogo e os limites (tamanho do nome, jogadores por sala etc.) são constantes no código, não variáveis de ambiente:

- Regras e física: `src/game.ts` e `src/stadium.ts`.
- Limites de texto e intervalo de ping: `src/net/protocol.ts`.
- Jogadores por sala (`MAX_PLAYERS_PER_ROOM`) e tempo de volta à sala após o fim (`GAME_OVER_DELAY_TICKS`): `server/room.ts`.

### Endpoints

| Caminho | Descrição |
| --- | --- |
| `/` | O jogo |
| `/ws` | WebSocket do multiplayer |
| `/health` | Verificação de saúde. Responde `{"status":"ok","rooms":N}`. Usado pelo Docker e por plataformas de hospedagem |

## Docker

Arquivos envolvidos:

- **`Dockerfile`** (build em dois estágios):
  1. **build:** instala tudo, checa os tipos e gera `dist/`.
  2. **runtime:** instala só as dependências de produção (`ws` e `tsx`) e copia `dist/`, `server/` e `src/`. O servidor importa o código do jogo de `src/` e roda o TypeScript direto com `tsx`.
  - Roda com o usuário `node` (sem privilégios de root), expõe a porta 8787 e tem `HEALTHCHECK` em `/health`.
- **`compose.yaml`:** sobe o serviço `haxlike` com `restart: unless-stopped`.
- **`.dockerignore`:** deixa `node_modules`, `dist`, `.git` e documentação fora da imagem.

### Com Docker Compose (recomendado)

```bash
docker compose up -d --build
```

- **Abrir o jogo:** http://localhost:8787
- **Ver logs:** `docker compose logs -f`
- **Ver status e saúde:** `docker compose ps` (deve aparecer `healthy`)
- **Parar e remover:** `docker compose down`
- **Atualizar depois de mudar o código:** `docker compose up -d --build` de novo

Para usar outra porta no seu computador (por exemplo, se o `npm run dev` já estiver usando a 8787):

```bash
# PowerShell
$env:HOST_PORT = "8788"; docker compose up -d --build

# bash
HOST_PORT=8788 docker compose up -d --build
```

### Só com Docker

```bash
docker build -t haxlike .
docker run -d --name haxlike -p 8787:8787 --restart unless-stopped haxlike
```

Para parar e remover: `docker rm -f haxlike`.

### Detalhes do container

- **Encerramento:** ao receber `SIGTERM` (`docker stop`), o servidor fecha as conexões e sai em cerca de 1 segundo.
- **Estado:** as salas ficam só na memória. Reiniciar o container encerra todas as salas e partidas.
- **Tamanho:** a imagem tem por volta de 350 MB, com base em `node:22-slim`.

## Jogando com outras pessoas

### Mesma rede (Wi-Fi / LAN)

1. Descubra seu IP local com `ipconfig` no Windows (campo "Endereço IPv4") ou `ip addr` no Linux.
2. Os outros abrem `http://SEU-IP:8787`.
3. No Windows, permita o Node.js (ou o Docker) no firewall quando ele perguntar.

### Pela internet, a partir do seu PC

Use um túnel, que não exige abrir portas no roteador:

```bash
cloudflared tunnel --url http://localhost:8787
```

Ele mostra um endereço `https://….trycloudflare.com` para compartilhar. O jogo continua rodando no seu PC, então ele precisa ficar ligado. O `ngrok http 8787` funciona do mesmo jeito.

### Hospedagem

A imagem Docker roda em qualquer serviço que aceite containers com **WebSocket** e **processo sempre ligado**. Hospedagens "serverless" (Vercel, Netlify Functions) não servem.

Como é um jogo de reflexo, escolha um servidor perto dos jogadores. Para o Brasil, prefira a região **São Paulo**:

| Opção | Região SP | Observação |
| --- | --- | --- |
| Fly.io | Sim (`gru`) | Faz deploy direto do `Dockerfile` |
| Oracle Cloud (Always Free) | Sim | VM grátis; instale o Docker e use o `compose.yaml` |
| Vultr / AWS Lightsail | Sim | VPS paga; instale o Docker e use o `compose.yaml` |
| Render / Railway | Não | Fácil, mas com ping mais alto para o Brasil |

Se a plataforma colocar o jogo atrás de HTTPS, o cliente usa `wss://` automaticamente.

## Problemas comuns

| Sintoma | Causa provável e solução |
| --- | --- |
| `EADDRINUSE` / porta em uso | Já tem algo na 8787 (outro `npm run dev` ou o container). Pare o outro processo ou troque `PORT` / `HOST_PORT`. |
| "Não foi possível conectar ao servidor" | O servidor não está rodando, ou a página foi aberta por um endereço diferente do servidor. |
| Página com "Build não encontrado" | Você rodou `npm start` sem `npm run build` antes. |
| Amigos na rede não conseguem abrir | Firewall do Windows bloqueando o Node/Docker, ou IP errado. |
| `docker` diz que não conecta ao daemon | O Docker Desktop está fechado. Abra e espere ele iniciar. |
| Jogador de uma janela "congela" ao testar sozinho | O navegador pausa abas em segundo plano. Use duas **janelas** lado a lado em vez de abas. |
