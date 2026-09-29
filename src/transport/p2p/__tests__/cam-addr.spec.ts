import { describe, expect, it, vi } from "vitest";
import { P2PSession } from "../p2p-session.js";
import { ResponseMessageType, p2pDidToBuffer } from "../codec.js";

/**
 * The device's own address record (`0xf143`, CAM_ADDR) is a recognised type. A T8354 answers CHECK_CAM with 51
 * copies of it before CAM_ID. The session is driven directly with a stubbed socket, so no UDP is involved.
 */
interface Internals {
  socket: { send: ReturnType<typeof vi.fn> };
  onMessage(msg: Buffer, rinfo: { address: string; port: number }): void;
}

/**
 * A synthetic CAM_ADDR in the measured layout: the 4-byte header, then the 20-byte device id, one address record
 * (`0x0002`, port little-endian, IPv4 byte-reversed, 8 zero bytes) and 8 more zero bytes. The address is zeros.
 */
function camAddr(): Buffer {
  const record = Buffer.alloc(16);
  record.writeUInt16BE(0x0002, 0);
  record.writeUInt16LE(32100, 2);
  const payload = Buffer.concat([p2pDidToBuffer("XXXXXXX-000000-XXXXX"), record, Buffer.alloc(8)]);
  const header = Buffer.alloc(4);
  ResponseMessageType.CAM_ADDR.copy(header, 0);
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

describe("P2P CAM_ADDR", () => {
  it("does not trace the device's address record as UNHANDLED, and still traces an unmodelled type", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const session = new P2PSession({ stationSn: "T8000P0000000000", p2pDid: "XXXXXXX-000000-XXXXX", logger });
    const internals = session as unknown as Internals;
    internals.socket = { send: vi.fn() };
    const rinfo = { address: "<cam-lan-ip>", port: 32100 };

    for (let i = 0; i < 51; i++) internals.onMessage(camAddr(), rinfo);
    internals.onMessage(Buffer.from([0xf1, 0x69, 0x00, 0x00]), rinfo);

    const unhandled = logger.debug.mock.calls.map(([m]) => String(m)).filter((m) => m.includes("UNHANDLED"));
    expect(unhandled).toHaveLength(1);
    expect(unhandled[0]).toContain("f1690000");
  });
});
