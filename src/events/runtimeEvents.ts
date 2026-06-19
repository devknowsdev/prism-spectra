import { randomUUID } from 'crypto';
import type { ForgeEvent } from './types';

export function createRuntimeEvent<T>(type: string, payload: T): ForgeEvent<T> {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}
