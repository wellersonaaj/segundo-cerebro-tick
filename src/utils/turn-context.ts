import { AsyncLocalStorage } from 'node:async_hooks';
import { startTurn, type TurnHandle } from './structured-logger.js';

export interface TurnCtx {
  turn_id: string;
  user_id?: number;
  chat_id?: number;
  message_id?: number;
  started_at: number;
  handle: TurnHandle;
}

const storage = new AsyncLocalStorage<TurnCtx>();

export function getCurrentTurn(): TurnCtx | null {
  return storage.getStore() ?? null;
}

export function runWithTurn<T>(
  ctx: Omit<TurnCtx, 'handle' | 'started_at'>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const handle = startTurn({
    turn_id: ctx.turn_id,
    user_id: ctx.user_id,
    chat_id: ctx.chat_id,
    message_id: ctx.message_id,
  });
  const fullCtx: TurnCtx = { ...ctx, started_at: Date.now(), handle };
  return storage.run(fullCtx, () => Promise.resolve(fn()));
}
