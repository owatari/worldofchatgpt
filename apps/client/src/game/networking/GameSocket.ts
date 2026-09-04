import type { ClientMessage, ServerMessage } from '@worldofchatgpt/shared';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001/ws';

export class GameSocket {
  private socket: WebSocket | null = null;
  constructor(private readonly token: string, private readonly onMessage: (message: ServerMessage) => void, private readonly onStatus: (status: string) => void) {}

  connect(): void {
    this.onStatus('Connecting…');
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    socket.addEventListener('open', () => this.onStatus('Connected'));
    socket.addEventListener('close', () => this.onStatus('Disconnected'));
    socket.addEventListener('error', () => this.onStatus('Connection error'));
    socket.addEventListener('message', (event) => {
      try { this.onMessage(JSON.parse(String(event.data)) as ServerMessage); } catch { this.onStatus('Protocol error'); }
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void { this.socket?.close(); this.socket = null; }
}
