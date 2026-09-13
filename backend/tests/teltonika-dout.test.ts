import { describe, it, expect } from '@jest/globals';
import {
  buildSetDigout,
  formatSetDigoutReply,
  levelFromReply,
  parseSetDigoutCommand,
  parseSetDigoutReply,
} from '../src/lib/teltonika-dout';
import { decodeCodec12Command, encodeCodec12Command, encodeCodec12Response } from '../src/lib/codec12';
import { TeltonikaCodec12Parser, TeltonikaCodec12Command } from '@groupe-savoy/teltonika-sdk';

describe('setdigout, as the FMC130/FMC150 firmware reads it', () => {
  it('raises and drops DOUT1 with the shortest form, leaving DOUT2 alone', () => {
    expect(buildSetDigout({ output: 1, level: 1 })).toBe('setdigout 1?');
    expect(buildSetDigout({ output: 1, level: 0 })).toBe('setdigout 0?');
  });

  it('can still carry a timeout and a speed ceiling in their positional slots', () => {
    expect(buildSetDigout({ output: 1, level: 1, timeoutSeconds: 0, maxSpeedKph: 5 })).toBe(
      'setdigout 1? 0 ? 5 ?'
    );
  });

  it('fills the positional slots for DOUT2 as well', () => {
    expect(buildSetDigout({ output: 2, level: 1, timeoutSeconds: 30 })).toBe('setdigout ?1 ? 30');
  });

  it('round-trips through the parser the simulated device uses', () => {
    const parsed = parseSetDigoutCommand('setdigout 1? 0 ? 5 ?');
    expect(parsed).toEqual({
      levels: [1, null],
      timeouts: [0, null],
      maxSpeeds: [5, null],
    });
    expect(parseSetDigoutCommand('getinfo')).toBeNull();
    expect(parseSetDigoutCommand('setdigout 2')).toBeNull();
  });
});

describe('the device reply', () => {
  it('reports the levels now held and which output they refer to', () => {
    const reply = parseSetDigoutReply('DOUTS are set to:10 TMOs are: 0 0');
    expect(reply).toEqual({ levels: '10', timeouts: [0, 0] });
    expect(levelFromReply(reply!, 1)).toBe(1);
    expect(levelFromReply(reply!, 2)).toBe(0);
  });

  it('is what the simulator formats', () => {
    expect(formatSetDigoutReply([1, 0], [0, 0])).toBe('DOUTS are set to:10 TMOs are: 0 0');
  });

  it('ignores any other reply text', () => {
    expect(parseSetDigoutReply('unknown command or invalid format')).toBeNull();
  });
});

describe('Codec 12 framing', () => {
  it('decodes the command frame the SDK server sends', () => {
    const frame = new TeltonikaCodec12Command('setdigout 1? 0 ? 5 ?').toBuffer();
    expect(decodeCodec12Command(frame)).toBe('setdigout 1? 0 ? 5 ?');
    expect(decodeCodec12Command(encodeCodec12Command('getio'))).toBe('getio');
  });

  it('produces a response frame the SDK server parses', () => {
    const parser = new TeltonikaCodec12Parser();
    const frame = encodeCodec12Response('DOUTS are set to:10 TMOs are: 0 0');
    expect(parser.isPacket(frame)).toBe(true);
    const packet = parser.parsePacket(frame);
    expect(packet.records[0].response).toBe('DOUTS are set to:10 TMOs are: 0 0');
  });

  it('does not mistake a record acknowledgement for a command', () => {
    expect(decodeCodec12Command(Buffer.from([0, 0, 0, 1]))).toBeNull();
  });
});
