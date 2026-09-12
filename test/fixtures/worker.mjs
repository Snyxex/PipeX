import { setTimeout as delay } from 'node:timers/promises';

export default function identity(input) {
  return input;
}

export function encode(input) {
  const value = new Uint8Array(input);
  for (let index = 0; index < value.length; index++) value[index] ^= 0x42;
  return value;
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
