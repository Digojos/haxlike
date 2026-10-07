# Arquitetura

## Visão geral

```
Navegador (cliente)                         Servidor Node (server/)
┌──────────────────────────┐   WebSocket   ┌──────────────────────────────┐
│ online/session.ts        │ ───input────▶ │ index.ts  (conexões, salas)  │
│  - predição do jogador   │               │ room.ts   (times, admin)     │
│  - interpolação do resto │ ◀──estado──── │  └─ Game (src/game.ts) 60 Hz │
│ render.ts (canvas)       │               │                              │
└──────────────────────────┘               └──────────────────────────────┘
          ▲                                             ▲
          └──── código compartilhado: src/game.ts, src/physics.ts,
                src/stadium.ts, src/net/protocol.ts ────┘
```

- **Servidor autoritativo:** o servidor roda a simulação oficial. O cliente só envia teclas e desenha o que o servidor manda. Ninguém consegue alterar a física pelo navegador.
- **Código compartilhado:** a mesma física e as mesmas regras rodam nos modos locais, no servidor e na predição do cliente.

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/physics.ts` | Mundo físico: discos, segmentos, planos, postes e colisões |
| `src/stadium.ts` | Geometria do estádio "Classic" (linhas, redes, traves) |
| `src/game.ts` | Regras: entrada dos jogadores, chute, saída de bola, gols, relógio, prorrogação |
| `src/bot.ts` | IA do bot do modo treino |
| `src/input.ts` | Teclado e mapeamentos de teclas |
| `src/render.ts` | Desenho no canvas, a partir de uma `RenderView` |
| `src/main.ts` | Loop principal, menu, modos locais e placar |
| `src/ui.ts` | Utilitários de DOM (mostrar e esconder diálogos) |
| `src/net/protocol.ts` | Tipos de todas as mensagens cliente ↔ servidor |
| `src/online/session.ts` | Conexão WebSocket, buffer de estados, interpolação e predição |
| `src/online/ui.ts` | Telas de nick, lista de salas, sala e chat |
| `server/index.ts` | HTTP (Vite em dev, `dist/` em produção), WebSocket, roteamento de mensagens, loop de 60 Hz |
| `server/room.ts` | Sala: jogadores, times, admin, configurações, partida e envio de estado |

## Simulação

- **Passo fixo:** a simulação avança em passos de 1/60 s. Os loops usam um acumulador de tempo, então a física é igual em qualquer máquina.
- **Ordem de cada passo (`Game.tick`):**
  1. lê a entrada de cada jogador e aplica movimento e chute;
  2. integra a posição e aplica o amortecimento;
  3. resolve as colisões disco × disco, depois disco × postes, segmentos e planos;
  4. atualiza a fase do jogo (saída de bola → jogando → gol → fim).
- **Barreiras da saída de bola:** são planos e um círculo extras que só valem para certas camadas (`mask`), definidos em `stadiumColliders()`.

## Rede

### Fluxo de uma partida

1. A cada passo (60 vezes por segundo), o cliente lê o teclado e envia `{ t: 'input', seq, keys }`. `keys` é um bitmask: cima 1, baixo 2, esquerda 4, direita 8, chute 16.
2. O servidor guarda as entradas numa fila por jogador e consome **uma por passo**. Se a fila passar de 4 itens, descarta os mais antigos, para um cliente adiantado não acumular atraso.
3. Depois de cada passo, o servidor envia `{ t: 'state', ack, s }` para todos:
   - `s` é o estado completo: posição e velocidade de todos, fase, placar e relógio;
   - `ack` é o último `seq` aplicado daquele jogador.

### Predição (seu jogador)

- O cliente simula o próprio jogador localmente, com a mesma `applyMovement` e as mesmas paredes. Por isso ele responde na hora.
- Quando chega um estado do servidor, o cliente parte da posição oficial e **reaplica** as entradas ainda não confirmadas (`seq > ack`).
- A diferença entre a previsão antiga e a nova é escondida aos poucos (`SMOOTHING`). Diferenças grandes, como o reposicionamento na saída de bola, pulam direto (`SNAP_DISTANCE`).
- A predição ignora colisões com a bola e com outros jogadores. Por isso há pequenas correções quando você empurra alguém ou conduz a bola.

### Interpolação (bola e outros jogadores)

- O cliente estima o relógio do servidor a partir da chegada dos estados.
- Ele desenha a bola e os outros jogadores `INTERP_DELAY_TICKS` (4 passos, cerca de 66 ms) no passado, misturando os dois estados mais próximos. Assim o movimento fica liso mesmo com variação de rede.

### Mensagens

Cliente → servidor:

| `t` | Campos | Descrição |
| --- | --- | --- |
| `hello` | `name` | Primeira mensagem: define o nick |
| `listRooms` | — | Pede a lista de salas |
| `createRoom` | `name` | Cria e entra numa sala (vira admin) |
| `joinRoom` | `roomId` | Entra numa sala |
| `leaveRoom` | — | Sai da sala |
| `setTeam` | `playerId`, `team` (`'red'`, `'blue'` ou `null`) | Troca de time (o próprio, ou de outro se for admin) |
| `start` / `stop` | — | Inicia ou para a partida (admin) |
| `settings` | `settings` | Tempo e limite de gols (admin) |
| `chat` | `text` | Mensagem ou comando (`/avatar`) |
| `input` | `seq`, `keys` | Teclas de um passo |
| `ping` | `time`, `ping` | Medição de latência; envia também o último ping medido |

Servidor → cliente:

| `t` | Campos | Descrição |
| --- | --- | --- |
| `welcome` | `id` | Seu id de jogador |
| `rooms` | `rooms` | Lista de salas |
| `joined` / `left` | `roomId`, `name` / — | Entrou ou saiu de uma sala |
| `room` | `players`, `running`, `settings` | Estado da sala (enviado a cada mudança) |
| `chat` | `from` (`null` = sistema), `text` | Mensagem de chat |
| `state` | `ack`, `s` | Estado da partida a cada passo |
| `pings` | `pings` (`[id, ms][]`) | Ping de todos da sala, a cada 2 s |
| `pong` | `time` | Resposta ao `ping` |
| `error` | `message` | Erro para mostrar ao usuário |

### Limites e validação no servidor

- Mensagens maiores que 4 KB são recusadas.
- Nomes, nomes de sala e chat têm caracteres de controle removidos e tamanho limitado.
- Ações de admin são verificadas no servidor.
- O ping é informado pelo próprio cliente. Serve para exibição, mas não é confiável contra trapaça.

## Como estender

- **Novo estádio:** crie a geometria em `src/stadium.ts` (segmentos, planos, postes) e ajuste `render.ts` para desenhá-la. Hoje há apenas o "Classic".
- **Nova mensagem de rede:** adicione o tipo em `src/net/protocol.ts`, trate no `switch` de `server/index.ts` (ou em `Room`) e em `OnlineSession.handle`. O TypeScript aponta os casos faltando.
- **Ajustar a física:** altere `PLAYER_PHYSICS` / `BALL_PHYSICS` em `src/game.ts`. A mudança vale para os modos locais, o servidor e a predição de uma vez.
