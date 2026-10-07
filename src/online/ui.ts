import type { Team } from '../game';
import { BINDINGS, isTypingTarget, keyboardController } from '../input';
import type { RoomPlayer, RoomSummary } from '../net/protocol';
import { byId, showPanel } from '../ui';
import { OnlineSession } from './session';

const NAME_STORAGE_KEY = 'haxlike.name';
const MAX_CHAT_LINES = 100;

type Column = Team | 'spec';
const COLUMN_ORDER: Column[] = ['red', 'spec', 'blue'];
const columnTeam = (column: Column): Team | null => (column === 'spec' ? null : column);

/** Online lobby, room screen and chat. Owns the OnlineSession while connected. */
export class OnlineUi {
  session: OnlineSession | null = null;
  private roomViewOpen = true;
  private wasRunning = false;
  private closingOnPurpose = false;
  private readonly readInput = keyboardController(BINDINGS.solo);

  private readonly el = {
    nickForm: byId<HTMLFormElement>('nick-form'),
    nickInput: byId<HTMLInputElement>('nick-input'),
    nickError: byId('nick-error'),
    roomList: byId('room-list'),
    roomsEmpty: byId('rooms-empty'),
    roomsError: byId('rooms-error'),
    createForm: byId<HTMLFormElement>('create-form'),
    roomNameInput: byId<HTMLInputElement>('room-name-input'),
    roomTitle: byId('room-title'),
    teamLists: { red: byId('team-red'), spec: byId('team-spec'), blue: byId('team-blue') } as Record<Column, HTMLElement>,
    timeLimit: byId<HTMLSelectElement>('time-limit'),
    scoreLimit: byId<HTMLSelectElement>('score-limit'),
    startStop: byId<HTMLButtonElement>('start-stop'),
    chat: byId('chat'),
    chatLog: byId('chat-log'),
    chatInput: byId<HTMLInputElement>('chat-input'),
  };

  constructor(private readonly exit: () => void) {
    const { el } = this;

    el.nickForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = el.nickInput.value.trim();
      if (!name) return;
      safeStorage(() => localStorage.setItem(NAME_STORAGE_KEY, name));
      this.connect(name);
    });
    byId('nick-back').addEventListener('click', () => this.exit());

    byId('create-room').addEventListener('click', () => {
      el.roomNameInput.value = '';
      showPanel('create-dialog');
      el.roomNameInput.focus();
    });
    el.createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.session?.send({ t: 'createRoom', name: el.roomNameInput.value });
    });
    byId('create-cancel').addEventListener('click', () => showPanel('rooms-dialog'));
    byId('refresh-rooms').addEventListener('click', () => this.session?.send({ t: 'listRooms' }));
    byId('rooms-back').addEventListener('click', () => {
      this.disconnect();
      this.exit();
    });
    el.roomList.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-id]');
      if (row) this.session?.send({ t: 'joinRoom', roomId: row.dataset.id! });
    });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-join]')) {
      button.addEventListener('click', () => {
        const session = this.session;
        session?.send({ t: 'setTeam', playerId: session.myId, team: columnTeam(button.dataset.join as Column) });
      });
    }
    // Admin arrows next to each player name.
    for (const list of Object.values(el.teamLists)) {
      list.addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-move]');
        if (!button) return;
        const team = columnTeam(button.dataset.move as Column);
        this.session?.send({ t: 'setTeam', playerId: Number(button.dataset.player), team });
      });
    }
    el.startStop.addEventListener('click', () => this.session?.send({ t: this.session.running ? 'stop' : 'start' }));
    byId('leave-room').addEventListener('click', () => this.session?.send({ t: 'leaveRoom' }));
    for (const select of [el.timeLimit, el.scoreLimit]) {
      select.addEventListener('change', () => {
        this.session?.send({
          t: 'settings',
          settings: { timeLimitMinutes: Number(el.timeLimit.value), scoreLimit: Number(el.scoreLimit.value) },
        });
        select.blur();
      });
    }

    el.chatInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const text = el.chatInput.value.trim();
        if (text) this.session?.send({ t: 'chat', text });
        el.chatInput.value = '';
        el.chatInput.blur();
      } else if (e.code === 'Escape') {
        el.chatInput.blur();
        e.stopPropagation();
      }
    });
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this.session?.inRoom && !isTypingTarget(e.target)) {
        e.preventDefault();
        el.chatInput.focus();
      }
    });
  }

  /** The online room is what should be drawn on the field (instead of the demo match). */
  get showingRoom(): boolean {
    return this.session?.inRoom ?? false;
  }

  open(): void {
    this.showNickDialog();
  }

  /** Esc while a match is running toggles the room screen, like in HaxBall. */
  handleEscape(): void {
    if (!this.session?.inRoom || !this.session.running) return;
    this.roomViewOpen = !this.roomViewOpen;
    this.refreshPanels();
  }

  private showNickDialog(error?: string): void {
    const { el } = this;
    el.nickInput.value = safeStorage(() => localStorage.getItem(NAME_STORAGE_KEY)) ?? '';
    el.nickError.textContent = error ?? '';
    el.nickError.classList.toggle('hidden', !error);
    showPanel('nick-dialog');
    el.nickInput.focus();
  }

  private connect(name: string): void {
    this.el.roomsError.classList.add('hidden');
    this.renderRoomList([]);
    this.el.roomsEmpty.textContent = 'Conectando...';
    showPanel('rooms-dialog');

    let opened = false;
    this.session = new OnlineSession(name, this.readInput, {
      onRooms: (rooms) => {
        opened = true;
        this.renderRoomList(rooms);
        if (!this.session?.inRoom) showPanel('rooms-dialog');
      },
      onJoined: () => {
        this.roomViewOpen = true;
        this.wasRunning = false;
        this.el.chatLog.replaceChildren();
        this.el.chat.classList.remove('hidden');
        this.renderRoom();
      },
      onLeft: () => {
        this.el.chat.classList.add('hidden');
        showPanel('rooms-dialog');
      },
      onRoom: () => this.renderRoom(),
      onChat: (from, text) => this.appendChat(from, text),
      onError: (message) => {
        if (this.session?.inRoom) return this.appendChat(null, message);
        this.el.roomsError.textContent = message;
        this.el.roomsError.classList.remove('hidden');
      },
      onClose: () => {
        this.session = null;
        this.el.chat.classList.add('hidden');
        if (this.closingOnPurpose) {
          this.closingOnPurpose = false;
          return;
        }
        this.showNickDialog(opened ? 'Conexão com o servidor perdida.' : 'Não foi possível conectar ao servidor.');
      },
    });
  }

  private disconnect(): void {
    if (!this.session) return;
    this.closingOnPurpose = true;
    this.session.close();
  }

  private refreshPanels(): void {
    const session = this.session;
    if (!session?.inRoom) return;
    showPanel(this.roomViewOpen || !session.running ? 'room-dialog' : null);
  }

  private renderRoomList(rooms: RoomSummary[]): void {
    const { el } = this;
    el.roomList.replaceChildren(
      ...rooms.map((room) => {
        const row = document.createElement('tr');
        row.dataset.id = room.id;
        row.append(
          cell(room.name),
          cell(`${room.players}/${room.maxPlayers}`),
          cell(room.running ? 'Em jogo' : 'Aguardando'),
        );
        return row;
      }),
    );
    el.roomsEmpty.textContent = 'Nenhuma sala aberta. Crie a primeira!';
    el.roomsEmpty.classList.toggle('hidden', rooms.length > 0);
  }

  private renderRoom(): void {
    const session = this.session;
    if (!session) return;
    const { el } = this;
    const isAdmin = session.me?.admin ?? false;

    // A match starting hides the room screen; a match ending brings it back.
    if (session.running && !this.wasRunning) this.roomViewOpen = false;
    this.wasRunning = session.running;

    el.roomTitle.textContent = session.roomName;
    for (const column of COLUMN_ORDER) {
      const team = columnTeam(column);
      const members = session.players.filter((p) => p.team === team);
      el.teamLists[column].replaceChildren(...members.map((p) => this.playerItem(p, column, isAdmin)));
    }

    el.timeLimit.value = String(session.settings.timeLimitMinutes);
    el.scoreLimit.value = String(session.settings.scoreLimit);
    el.timeLimit.disabled = el.scoreLimit.disabled = !isAdmin;
    el.startStop.textContent = session.running ? 'Parar partida' : 'Iniciar partida';
    el.startStop.disabled = !isAdmin;
    el.startStop.title = isAdmin ? '' : 'Só o admin pode iniciar a partida';

    this.refreshPanels();
  }

  private playerItem(player: RoomPlayer, column: Column, isAdmin: boolean): HTMLElement {
    const item = document.createElement('li');
    if (player.id === this.session?.myId) item.classList.add('me');

    const index = COLUMN_ORDER.indexOf(column);
    const moveButton = (target: Column | undefined, label: string) => {
      const button = document.createElement('button');
      button.className = 'move';
      button.textContent = label;
      if (target) {
        button.dataset.move = target;
        button.dataset.player = String(player.id);
      } else button.style.visibility = 'hidden';
      return button;
    };

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = (player.avatar ? `[${player.avatar}] ` : '') + player.name;
    if (player.admin) name.title = 'Admin';

    if (isAdmin) item.append(moveButton(COLUMN_ORDER[index - 1], '◀'));
    item.append(name);
    if (player.admin) {
      const badge = document.createElement('span');
      badge.className = 'admin-badge';
      badge.textContent = '★';
      item.append(badge);
    }
    const ping = document.createElement('span');
    ping.className = `ping ${pingQuality(player.ping)}`;
    ping.textContent = `${player.ping} ms`;
    ping.title = 'Ping';
    item.append(ping);
    if (isAdmin) item.append(moveButton(COLUMN_ORDER[index + 1], '▶'));
    return item;
  }

  private appendChat(from: string | null, text: string): void {
    const { chatLog } = this.el;
    const line = document.createElement('div');
    if (from === null) {
      line.className = 'system';
      line.textContent = text;
    } else {
      const who = document.createElement('b');
      who.textContent = `${from}: `;
      line.append(who, text);
    }
    chatLog.append(line);
    while (chatLog.childElementCount > MAX_CHAT_LINES) chatLog.firstElementChild!.remove();
    chatLog.scrollTop = chatLog.scrollHeight;
  }
}

function pingQuality(ms: number): 'good' | 'ok' | 'bad' {
  if (ms < 80) return 'good';
  return ms < 150 ? 'ok' : 'bad';
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function safeStorage<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
