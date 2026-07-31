'use strict';

const zlib = require('node:zlib');

/**
 * A tiny hand-generated placeholder icon (a solid-color circle on a
 * transparent 16x16 canvas) built from Node's built-in zlib alone — no
 * icon asset exists yet (that's NCOW-1.10 packaging's job), and this keeps
 * the tray functional in the meantime without adding an image dependency.
 *
 * @param {string} hexColor — e.g. '#2ecc71' (green), '#95a5a6' (gray), '#e74c3c' (red)
 * @returns {Buffer} a valid PNG buffer
 */
function generateDotIconPng(hexColor) {
  const size = 16;
  const [r, g, b] = hexToRgb(hexColor);
  const radius = size / 2 - 1;
  const center = size / 2 - 0.5;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const inside = dx * dx + dy * dy <= radius * radius;
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = inside ? 255 : 0;
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    pngChunk('IHDR', ihdr(size, size)),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(width, 0);
  buf.writeUInt32BE(height, 4);
  buf[8] = 8; // bit depth
  buf[9] = 6; // color type: RGBA
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace
  return buf;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lengthBuf = Buffer.alloc(4);
  lengthBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf]);
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { generateDotIconPng };
