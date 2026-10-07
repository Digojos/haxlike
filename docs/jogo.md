# O jogo

HaxLike é um jogo de futebol 2D visto de cima, no estilo do HaxBall: cada jogador é um círculo, a bola é um círculo menor e tudo acontece por física de colisões.

## Modos

| Modo | Onde | Descrição |
| --- | --- | --- |
| **Jogar online** | Menu → Jogar online | Salas multiplayer pelo servidor. Até 12 pessoas por sala. |
| **Treino contra bot** | Menu | Você (Vermelho) contra um bot (Azul), no próprio navegador. |
| **2 jogadores (mesmo teclado)** | Menu | Duas pessoas no mesmo computador. |

Os modos locais não precisam de conexão com o servidor depois que a página carrega.

## Controles

| Ação | Online e treino | 2 jogadores: Vermelho | 2 jogadores: Azul |
| --- | --- | --- | --- |
| Mover | Setas ou WASD | WASD | Setas |
| Chutar | X ou Espaço | Espaço | Enter (ou 0 do teclado numérico) |

Outras teclas:

- **Esc:** nos modos locais, volta ao menu. Online, mostra ou esconde a tela da sala durante a partida.
- **Enter (online):** abre o chat. Enter de novo envia e Esc cancela.

### Como o chute funciona

- Enquanto você segura a tecla de chute, o contorno do seu jogador fica **branco** e você acelera um pouco mais devagar.
- O chute dispara assim que a bola estiver ao alcance, a até 4 unidades da borda do jogador.
- Cada aperto chuta **uma vez**. Para chutar de novo, solte e aperte outra vez.
- A bola sai na direção que vai do centro do jogador ao centro da bola. Para mirar, posicione o corpo.

## Regras da partida

- **Saída de bola:** começa com o Vermelho. Depois de cada gol, quem sofreu o gol dá a saída.
  - Durante a saída, cada time fica no seu lado do campo.
  - O time que **não** está com a saída também não pode entrar no círculo central.
  - As barreiras somem assim que alguém toca na bola.
- **Gol:** conta quando o centro da bola cruza a linha do gol entre as traves. Aparece "Gol do Vermelho!" ou "Gol do Azul!" e, 3 segundos depois, há uma nova saída de bola.
- **Relógio:** só corre com a bola em jogo. Fica parado na saída de bola e nas comemorações de gol.
- **Fim de jogo:** acontece quando o tempo acaba ou quando um time atinge o limite de gols.
- **Prorrogação:** se o tempo acabar empatado, o jogo segue com **gol de ouro** (quem marcar primeiro vence). O relógio fica vermelho.
- **Limites:** nos modos locais são fixos, 3 minutos ou 3 gols. Online, o admin escolhe (0 = sem limite).

## O campo

É o estádio "Classic" do HaxBall, em unidades do jogo:

| Elemento | Medida |
| --- | --- |
| Área total (onde os jogadores podem andar) | 840 × 400 |
| Campo (linhas que seguram a bola) | 740 × 340 |
| Gol (largura entre as traves) | 128 |
| Profundidade da rede | 30 |
| Raio da trave | 8 |
| Raio do círculo central | 75 |
| Posição inicial dos jogadores | 170 do centro, para cada lado |

As linhas do campo seguram apenas a bola, então os jogadores podem correr por fora delas, como no original.

## Física

O jogo roda a **60 passos por segundo**. Os valores são os padrões do HaxBall:

| Parâmetro | Jogador | Bola |
| --- | --- | --- |
| Raio | 15 | 10 |
| Massa inversa (`invMass`) | 0,5 | 1 |
| Amortecimento por passo (`damping`) | 0,96 | 0,99 |
| Coeficiente de quique (`bCoef`) | 0,5 | 0,5 |
| Aceleração (normal / segurando chute) | 0,1 / 0,07 | — |
| Força do chute | 5 | — |

- O quique entre dois objetos usa o produto dos `bCoef` de ambos.
- As linhas laterais têm `bCoef` 1, então a bola quica bem.
- A rede tem `bCoef` 0,1 e absorve o impacto.
- Os valores ficam em `src/game.ts` (`PLAYER_PHYSICS`, `BALL_PHYSICS`) e `src/stadium.ts`.

## Salas online

1. **Nick:** você escolhe um nome de até 25 caracteres. Ele fica salvo no navegador.
2. **Lista de salas:** mostra nome, jogadores e status (Aguardando / Em jogo). Clique numa sala para entrar ou use **Criar sala**.
3. **Tela da sala:** três colunas, **Vermelho / Espectadores / Azul**. Quem entra numa sala começa como espectador.
   - O botão **Entrar** de cada coluna coloca você naquele time.
   - Ao lado de cada nome aparece o ping do jogador: verde abaixo de 80 ms, amarelo até 150 ms, vermelho acima disso.

### Admin (★)

O primeiro a entrar na sala é o admin. Se ele sair, o próximo da lista assume. Só o admin pode:

- iniciar e parar a partida;
- escolher o tempo (sem limite, 1, 2, 3, 5 ou 10 min) e o limite de gols (sem limite, 1, 2, 3, 5, 7 ou 10);
- mover outros jogadores entre as colunas com as setas ◀ ▶.

Cada jogador pode trocar o **próprio** time a qualquer momento, inclusive durante a partida.

### Chat

- Mensagens têm até 140 caracteres.
- Entradas, saídas, início e fim de partida aparecem em cinza.
- Comando **`/avatar XX`** coloca até 2 caracteres (letras, números, emoji) dentro do seu jogador. `/avatar` sem nada remove o avatar.

### Fim da partida online

Aparece no chat "Vermelho venceu! 3 - 1" (ou o equivalente) e, 3 segundos depois, todos voltam para a tela da sala. Os times são mantidos para a próxima partida.
