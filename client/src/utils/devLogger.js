const IS_DEV = Boolean(import.meta?.env?.DEV);

export const isDev = IS_DEV;

export function devLog(...args) {
  if (IS_DEV) console.log(...args);
}

export function devInfo(...args) {
  if (IS_DEV) console.info(...args);
}

export function devWarn(...args) {
  if (IS_DEV) console.warn(...args);
}

export function devError(...args) {
  if (IS_DEV) console.error(...args);
}

export function devDebug(...args) {
  if (IS_DEV) console.debug(...args);
}
