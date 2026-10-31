/** Piscina worker module: transfer-friendly byte arrays, no shared secrets. */
export function encode(input) {
  return Uint8Array.from(new Uint8Array(input)).reverse();
}
export function decode(input) {
  return encode(input);
}
