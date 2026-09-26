import { describe, expect, it } from "vitest";
import { P2PSession } from "../p2p-session.js";

/** A level-2 body opens with the GCM tag (16) and nonce (12); the sub-header follows. */
const TAG_AND_NONCE_BYTES = 28;

function subHeaders(frames: number): Buffer[] {
  const session = new P2PSession({ stationSn: "T8000P0000000000", p2pDid: "XXXXXXX-000000-XXXXX" });
  session.setLevel2Key(Buffer.alloc(32, 1));
  const encrypt = (session as unknown as { encryptLevel2(plaintext: Buffer): Buffer }).encryptLevel2.bind(session);
  return Array.from({ length: frames }, () =>
    encrypt(Buffer.from("{}")).subarray(TAG_AND_NONCE_BYTES, TAG_AND_NONCE_BYTES + 4),
  );
}

describe("the level-2 sub-header sequence", () => {
  it("carries into the next byte after [ff, 03, 02, 01]", () => {
    const headers = subHeaders(257);
    expect(headers[0]).toEqual(Buffer.from([0x00, 0x03, 0x02, 0x01]));
    expect(headers[255]).toEqual(Buffer.from([0xff, 0x03, 0x02, 0x01]));
    expect(headers[256]).toEqual(Buffer.from([0x00, 0x04, 0x02, 0x01]));
  });
});
