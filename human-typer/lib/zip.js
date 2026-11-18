// Minimal ZIP reader: central directory parsing, stored and deflate entries.
// Inflation uses DecompressionStream('deflate-raw') (Chrome, Node 18+).
// Not supported: ZIP64, encryption, multi-disk archives.
(function (root) {
  'use strict';

  const api = (root.HumanTyperDoc = root.HumanTyperDoc || {});

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (input && typeof input.byteLength === 'number') return new Uint8Array(input);
    throw new TypeError('Expected an ArrayBuffer or Uint8Array');
  }

  async function inflateRaw(data, name) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('DecompressionStream is not available in this environment');
    }
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      throw new Error(`Corrupt ZIP archive (could not decompress "${name}")`);
    }
  }

  // Parses the central directory synchronously (throws an Error when the input
  // is not a usable ZIP) and returns { names, has(name), read(name) } where
  // read() resolves to the entry's uncompressed bytes.
  function readZip(input) {
    const bytes = toBytes(input);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = bytes.length;

    // The end-of-central-directory record sits at the end, before an optional
    // comment of at most 65535 bytes.
    let eocd = -1;
    for (let p = size - 22; p >= 0 && p >= size - 22 - 0xffff; p--) {
      if (view.getUint32(p, true) === SIG_EOCD) {
        eocd = p;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a ZIP archive (end of central directory not found)');
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    if (count === 0xffff || pos === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported');
    }

    const decoder = new TextDecoder('utf-8');
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (pos + 46 > size || view.getUint32(pos, true) !== SIG_CENTRAL) {
        throw new Error('Corrupt ZIP archive (bad central directory)');
      }
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      entries.set(name, {
        encrypted: (view.getUint16(pos + 8, true) & 1) === 1,
        method: view.getUint16(pos + 10, true),
        compressedSize: view.getUint32(pos + 20, true),
        offset: view.getUint32(pos + 42, true),
      });
      pos += 46 + nameLen + extraLen + commentLen;
    }

    async function read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`ZIP entry not found: "${name}"`);
      if (e.encrypted) throw new Error('Encrypted ZIP archives are not supported');
      if (e.offset + 30 > size || view.getUint32(e.offset, true) !== SIG_LOCAL) {
        throw new Error(`Corrupt ZIP archive (bad local header for "${name}")`);
      }
      const start =
        e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
      if (start + e.compressedSize > size) {
        throw new Error(`Corrupt ZIP archive ("${name}" is truncated)`);
      }
      const data = bytes.subarray(start, start + e.compressedSize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data, name);
      throw new Error(`Unsupported ZIP compression method ${e.method} for "${name}"`);
    }

    return { names: Array.from(entries.keys()), has: (name) => entries.has(name), read };
  }

  api.readZip = readZip;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
