import { vi } from "vitest";
import { buildDirectBinaryBody } from "../write-commands.js";
import { buildIntCommandPayload } from "../codec.js";
import { connectedSession, routerWithSession, ACCOUNT_ID, STATION_SN } from "./session-fixtures.js";
import { P2P_ENVELOPE } from "../envelope.js";

/**
 * The RESTART_HUB (reboot) frame body, pinned against the real capture.
 *
 * Ground truth: a capture of the app's own "Restart" (2026-08-03) showed the station a
 * level-2 frame on channel 255, outer cmd 1034, whose body was `[u32 value=0][account_id ASCII,
 * zero-padded]` — and it rebooted the hub. `EufyMega.reboot` sends exactly this via the router's
 * station-scalar path (`buildDirectBinaryBody(0, accountId)` → `sendRawLevel2Bytes(..., 255, 1034,
 * 8)`), so this locks the body shape and the id.
 */
describe("RESTART_HUB reboot frame", () => {
  // Synthetic: the assertions are about the body SHAPE — 132 bytes, the field offset, the zero
  // padding — so only the 40-character length is load-bearing, never the value.
  const ACCOUNT = "0".repeat(40);

  it("uses the station-scalar (no-channel) body shape", () => {
    expect(P2P_ENVELOPE.RESTART_HUB).toBe(1034);

    const body = buildDirectBinaryBody(0, ACCOUNT); // value 0 — exactly what the captured frame carried
    // 4-byte value + 128-byte account field = the 132-byte station-scalar body (hub alarm volume shares it).
    expect(body.length).toBe(132);
    expect(body.readUInt32LE(0)).toBe(0);
    expect(body.subarray(4, 4 + ACCOUNT.length).toString("ascii")).toBe(ACCOUNT);
    // account field is zero-padded, not truncated or channel-prefixed.
    expect(body.subarray(4 + ACCOUNT.length).every((b) => b === 0)).toBe(true);
  });

  it("is NOT the channel-prefixed direct-binary shape (that's the device-channel controls)", () => {
    // A device control (e.g. PIR 1011) passes an explicit channel → an 8-byte prefix; the hub restart
    // does not. Guarding the distinction that the wrong shape would silently pass on the wire.
    const withChannel = buildDirectBinaryBody(0, ACCOUNT, 0);
    expect(withChannel.length).toBe(136);
    expect(buildDirectBinaryBody(0, ACCOUNT).length).toBe(132);
  });
});

/**
 * The seal follows the session. A keyed session gets the captured level-2 frame; a keyless one — a standalone
 * camera, which never negotiates a key — gets the same body sealed level-1, since a level-2 frame cannot be
 * built without the key.
 */
describe("RESTART_HUB seal", () => {
  it("frames the level-1 body as the captured level-2 body, on channel 255", () => {
    const frame = buildIntCommandPayload(0, ACCOUNT_ID, 255);
    const body = frame.subarray(10);
    expect(frame.readUInt16LE(0)).toBe(body.length);
    expect(frame[6]).toBe(255);
    expect(frame[7]).toBe(0);
    expect(body.equals(buildDirectBinaryBody(0, ACCOUNT_ID))).toBe(true);
  });

  it("marks and pads the level-1 body when a level-1 key seals it", () => {
    const frame = buildIntCommandPayload(0, ACCOUNT_ID, 255, Buffer.alloc(16, 1));
    expect(frame[7]).toBe(1);
    expect(frame.readUInt16LE(0) % 16).toBe(0);
  });

  it("sends the captured level-2 frame on a keyed session", async () => {
    const session = Object.assign(connectedSession(true), {
      sendRawLevel2Bytes: vi.fn(() => true),
      sendIntCommand: vi.fn(),
    });
    await routerWithSession(session).rebootStation(STATION_SN);
    expect(session.sendIntCommand).not.toHaveBeenCalled();
    expect(session.sendRawLevel2Bytes).toHaveBeenCalledWith(
      buildDirectBinaryBody(0, ACCOUNT_ID),
      255,
      P2P_ENVELOPE.RESTART_HUB,
      8,
    );
  });

  it("sends the level-1 frame on a keyless session, replayed like the level-2 one", async () => {
    const session = Object.assign(connectedSession(false), {
      sendRawLevel2Bytes: vi.fn(() => true),
      sendIntCommand: vi.fn(),
    });
    await routerWithSession(session).rebootStation(STATION_SN);
    expect(session.sendRawLevel2Bytes).not.toHaveBeenCalled();
    expect(session.sendIntCommand).toHaveBeenCalledWith(P2P_ENVELOPE.RESTART_HUB, 0, ACCOUNT_ID, 255);
    expect(session.sendIntCommand.mock.calls.length).toBeGreaterThan(1);
  });
});
