type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void };

type Handlers = {
  onNotification: (method: string, params: unknown) => void;
  /** サーバーから聞かれたことへの答え。知らないものは null で返す */
  onRequest: (method: string, params: unknown) => unknown;
};

type Message = {
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
};

/** JSON-RPC 2.0 の、言語サーバーとの 1 本のやりとり */
export class LanguageServerConnection {
  private nextId = 1;
  private readonly pending = new Map<number | string, Pending>();

  constructor(
    private readonly send: (text: string) => void,
    private readonly handlers: Handlers,
  ) {}

  request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  receive(text: string): void {
    let message: Message;
    try {
      message = JSON.parse(text) as Message;
    } catch {
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      this.write({ id: message.id, result: this.handlers.onRequest(message.method, message.params) ?? null });
    } else if (message.method !== undefined) {
      this.handlers.onNotification(message.method, message.params);
    } else if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
    }
  }

  /** 答えを待っているものは、すべて失敗にする */
  close(): void {
    for (const pending of this.pending.values()) pending.reject(new Error("Language server stopped"));
    this.pending.clear();
  }

  private write(message: object): void {
    this.send(JSON.stringify({ jsonrpc: "2.0", ...message }));
  }
}
