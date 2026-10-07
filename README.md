# HaxLike

Jogo de futebol multiplayer no estilo HaxBall, feito com TypeScript, Canvas e WebSocket.

- **Modos:** online com salas, chat e admin; treino contra bot; 2 jogadores no mesmo teclado.
- **Servidor autoritativo** a 60 passos por segundo, com predição e interpolação no cliente.
- **Visual e física** baseados no estádio "Classic" do HaxBall.

## Começando

### Com Node.js (22+)

```bash
npm install
npm run dev
```

Abra http://localhost:8787.

### Com Docker

```bash
docker compose up -d --build
```

Abra http://localhost:8787. Para parar: `docker compose down`.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [docs/jogo.md](docs/jogo.md) | Modos, controles, regras, física, salas online, admin e chat |
| [docs/ambiente.md](docs/ambiente.md) | Requisitos, scripts, variáveis de ambiente, Docker, como jogar com outras pessoas, hospedagem e problemas comuns |
| [docs/arquitetura.md](docs/arquitetura.md) | Estrutura do código, simulação, netcode e protocolo de mensagens |
| [docs/deploy-vps.md](docs/deploy-vps.md) | Deploy numa VPS que já tem nginx (subdomínio, WebSocket, HTTPS) |

## Controles rápidos

| | Online / treino | 2 jogadores |
| --- | --- | --- |
| Mover | Setas ou WASD | Vermelho: WASD · Azul: setas |
| Chutar | X ou Espaço | Vermelho: Espaço · Azul: Enter |

- **Online:** Enter abre o chat, Esc mostra ou esconde a sala e `/avatar XX` muda seu avatar.
