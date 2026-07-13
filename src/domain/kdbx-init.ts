/**
 * Wires the Argon2 KDF implementation into kdbxweb so KDBX4 (Argon2d/id) files
 * can be opened and created in the browser. Uses hash-wasm (WASM Argon2).
 */
import { CryptoEngine } from 'kdbxweb';
import { argon2d, argon2id } from 'hash-wasm';

let initialized = false;

export function initKdbxweb(): void {
  if (initialized) return;
  initialized = true;

  CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      const params = {
        password: new Uint8Array(password),
        salt: new Uint8Array(salt),
        parallelism,
        iterations,
        memorySize: memory, // KiB
        hashLength: length,
        outputType: 'binary' as const,
        version: version === 0x10 ? 16 : 19
      };
      // kdbxweb only emits Argon2d (0) or Argon2id (2).
      const fn = type === 0 ? argon2d : argon2id;
      const result = await fn(params);
      return result.buffer.slice(
        result.byteOffset,
        result.byteOffset + result.byteLength
      ) as ArrayBuffer;
    }
  );
}
