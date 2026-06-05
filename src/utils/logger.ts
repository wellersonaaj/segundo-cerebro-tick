import { randomUUID } from 'node:crypto';
import { startTurn } from './structured-logger.js';
import { getCurrentTurn } from './turn-context.js';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function writeLegacyStdout(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

async function delegateToStructured(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const turn = getCurrentTurn();
  const stageMeta = { level, ...meta };
  if (turn) {
    await turn.handle.stage(message, { meta: stageMeta });
    return;
  }
  const adHoc = startTurn({ turn_id: randomUUID(), input: message });
  await adHoc.stage(message, { meta: stageMeta });
  await adHoc.finish();
}

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  writeLegacyStdout(level, message, meta);
  void delegateToStructured(level, message, meta);
}
