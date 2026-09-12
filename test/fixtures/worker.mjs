import { setTimeout as delay } from 'node:timers/promises';

export default function identity(input) {
  return input;
}

export function encode(input) {
  return Uint8Array.from(new Uint8Array(input)).reverse();
}

export function decode(input) {
  return encode(input);
}

export async function slow(input) {
  await delay(200);
  return input;
}

export function fail() {
  throw new Error('fixture worker failure');
}

export function hang() {
  return new Promise(() => {});
}

export function crash() {
  process.exit(17);
}
