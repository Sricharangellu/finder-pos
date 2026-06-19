import type { Command, CommandType } from "./command-types.js";

type CommandHandler<T = Record<string, unknown>, R = unknown> = (cmd: Command<T>) => Promise<R>;

/**
 * Synchronous in-process command bus.
 * Commands have exactly one handler (unlike events which are fan-out).
 * This enables the CQRS side of the architecture without introducing
 * a separate message broker in Year 1.
 */
export class CommandBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly handlers = new Map<string, CommandHandler<any, any>>();

  register<T, R = void>(type: CommandType, handler: CommandHandler<T, R>): void {
    if (this.handlers.has(type)) {
      throw new Error(`CommandBus: handler already registered for '${type}'`);
    }
    this.handlers.set(type, handler);
  }

  async dispatch<T, R = void>(cmd: Command<T>): Promise<R> {
    const handler = this.handlers.get(cmd.type);
    if (!handler) {
      throw new Error(`CommandBus: no handler registered for '${cmd.type}'`);
    }
    return handler(cmd) as Promise<R>;
  }

  has(type: CommandType): boolean {
    return this.handlers.has(type);
  }

  registeredTypes(): string[] {
    return Array.from(this.handlers.keys());
  }
}
