// Codec 12 — Teltonika's GPRS command channel, riding on the same TCP socket
// as the AVL data. The SDK builds the server→device command frame; this is
// the device side of the exchange, which the simulated FMC150s need so they
// can be told to do something and answer the way a real unit does.
//
//   0000 0000 | size(4) | 0C | 01 | type | len(4) | text | 01 | CRC-16(4)
//
//   type 0x05 — command, server → device
//   type 0x06 — response, device → server
//
// The CRC covers codec byte through the trailing quantity byte, the same
// span the data frames use.
import { calculateCrc } from '@groupe-savoy/teltonika-sdk';

const CODEC_12 = 0x0c;
const TYPE_COMMAND = 0x05;
const TYPE_RESPONSE = 0x06;

const frame = (type: number, text: string): Buffer => {
  const body = Buffer.from(text, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length, 0);
  const content = Buffer.concat([
    Buffer.from([CODEC_12, 0x01, type]),
    len,
    body,
    Buffer.from([0x01]),
  ]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(content.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(calculateCrc(content), 0);
  return Buffer.concat([Buffer.alloc(4), size, content, crc]);
};

export const encodeCodec12Command = (text: string): Buffer => frame(TYPE_COMMAND, text);
export const encodeCodec12Response = (text: string): Buffer => frame(TYPE_RESPONSE, text);

/** The command text inside a server→device Codec 12 frame, or null for anything else. */
export function decodeCodec12Command(data: Buffer): string | null {
  if (data.length < 15) return null;
  if (data.readUInt32BE(0) !== 0) return null;
  if (data[8] !== CODEC_12 || data[10] !== TYPE_COMMAND) return null;
  const len = data.readUInt32BE(11);
  if (data.length < 15 + len) return null;
  return data.subarray(15, 15 + len).toString('utf8');
}
