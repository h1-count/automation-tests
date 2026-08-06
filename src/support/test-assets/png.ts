const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Adds a deterministic ancillary chunk before IEND without changing image pixels.
 * The returned PNG is at least `minimumBytes` and remains structurally decodable.
 */
export function createDeterministicOversizedPng(source: Buffer, minimumBytes: number): Buffer {
  if (!Number.isSafeInteger(minimumBytes) || minimumBytes <= source.length) {
    throw new Error("PNG minimumBytes must be a safe integer larger than the source asset.");
  }
  const iendOffset = findPngIendOffset(source);
  const textPrefix = Buffer.from("Comment\0", "latin1");
  const minimumPayloadLength = minimumBytes - source.length - 12;
  const payloadLength = Math.max(textPrefix.length, minimumPayloadLength);
  const payload = Buffer.alloc(payloadLength, 0x41);
  textPrefix.copy(payload);
  const chunkType = Buffer.from("tEXt", "ascii");
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  chunkType.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([chunkType, payload])), chunk.length - 4);
  return Buffer.concat([source.subarray(0, iendOffset), chunk, source.subarray(iendOffset)]);
}

function findPngIendOffset(source: Buffer): number {
  if (!source.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error("Source asset does not have a PNG signature.");
  }
  let offset = pngSignature.length;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > source.length) {
      throw new Error("Source PNG contains an invalid chunk length.");
    }
    if (source.toString("ascii", offset + 4, offset + 8) === "IEND") {
      return offset;
    }
    offset = chunkEnd;
  }
  throw new Error("Source PNG does not contain an IEND chunk.");
}

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
