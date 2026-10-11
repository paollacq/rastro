import { pixMode, shortError } from '@rastro/core';

// Pages read on the server and show an error state instead of crashing when the database
// or the chain doesn't answer.
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: string };

export async function load<T>(work: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    console.error(error);
    return { ok: false, reason: shortError(error) };
  }
}

// For the warning strip, even when nothing else loaded.
export const currentPixMode = () => pixMode();
