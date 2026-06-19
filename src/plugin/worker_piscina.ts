/**
 * worker_piscina.ts — The actual worker logic for Piscina.
 */

export default function processChunk(arrayBuffer: ArrayBuffer): ArrayBuffer {
  const buffer = Buffer.from(arrayBuffer);

  // Perform heavy CPU task (XOR for demo)
  // In an enterprise app, this would be a dynamic task or a more complex algorithm.
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = (buffer[i] as number) ^ 0x42;
  }

  return buffer.buffer;
}
