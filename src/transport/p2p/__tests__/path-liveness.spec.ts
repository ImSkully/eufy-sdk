import type dgram from "node:dgram";
import { describe, expect, it, vi } from "vitest";
import { P2PSession } from "../p2p-session.js";
import { LIVE_TRACE_MESSAGE } from "../live-trace.js";
import { ResponseMessageType, frameMessage } from "../codec.js";

/**
 * A measured wired-camera run had an 18 s idle interval, twenty unacknowledged retransmits on resume,
 * and an immediately streaming rebuilt session.
 *
 * PONG, PING, ACK and DATA on the selected peer path refresh liveness. Three silent heartbeat periods signal a
 * stale path once peer traffic has arrived; a path with no post-connect peer traffic remains unknown.
 */
const STATION_SN = "T8000P0000000000";
const P2P_DID = "XXXXXXX-000000-XXXXX";

function session() {
  const debug = vi.fn();
  const built = new P2PSession({
    stationSn: STATION_SN,
    p2pDid: P2P_DID,
    logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  const internals = built as unknown as {
    connectAddress?: { host: string; port: number };
    lastPeerAt?: number;
    connected: boolean;
    socket: dgram.Socket;
    lastPongData?: Buffer;
  };
  internals.connectAddress = { host: "203.0.113.1", port: 32100 };
  internals.connected = true;
  internals.socket = { send: vi.fn() } as unknown as dgram.Socket;
  return { built, internals, debug };
}

const traces = (debug: ReturnType<typeof vi.fn>) =>
  debug.mock.calls.filter(([message]) => message === LIVE_TRACE_MESSAGE).map(([, trace]) => trace);

/** Deliver a framed packet without binding a UDP port. */
function receive(
  built: P2PSession,
  type: Buffer,
  address: string,
  port = 32100,
  socket?: dgram.Socket,
  payload?: Buffer,
): void {
  const target = built as unknown as {
    socket: dgram.Socket;
    onMessage: (msg: Buffer, remote: { address: string; port: number }, socket: dgram.Socket) => void;
  };
  target.onMessage(frameMessage(type, payload), { address, port }, socket ?? target.socket);
}

describe("a session's path liveness", () => {
  it("is unknown until the selected peer sends post-connect traffic", () => {
    const { built } = session();
    expect(built.pathSilentMs).toBeUndefined();
  });

  it("is measured from the last selected-peer packet once one has arrived", () => {
    const { built, internals } = session();
    internals.lastPeerAt = Date.now() - 12_000;
    expect(built.pathSilentMs).toBeGreaterThanOrEqual(12_000);
  });

  it("answers that a path which has answered recently is alive", () => {
    const { built, internals } = session();
    internals.lastPeerAt = Date.now() - 1_000;
    expect(built.pathAnswering).toBe(true);
  });

  it("answers that a path silent past three heartbeats is not", () => {
    const { built, internals } = session();
    internals.lastPeerAt = Date.now() - 16_000;
    expect(built.pathAnswering).toBe(false);
  });

  it("keeps an active path alive on selected-peer traffic even without a PONG", () => {
    const { built, internals } = session();
    const handlers = built as unknown as { onAck: () => void; onData: () => void };
    handlers.onAck = vi.fn();
    handlers.onData = vi.fn();
    for (const type of [
      ResponseMessageType.PONG,
      ResponseMessageType.PING,
      ResponseMessageType.ACK,
      ResponseMessageType.DATA,
    ]) {
      internals.lastPeerAt = Date.now() - 16_000;
      receive(built, type, "203.0.113.1");
      expect(built.pathAnswering).toBe(true);
    }
  });

  it("does not count another endpoint or a losing lookup socket as the selected peer", () => {
    const { built, internals } = session();
    const losingSocket = { send: vi.fn() } as unknown as dgram.Socket;
    internals.lastPeerAt = Date.now() - 16_000;
    receive(built, ResponseMessageType.PONG, "203.0.113.2");
    receive(built, ResponseMessageType.PONG, "203.0.113.1", 32101);
    receive(built, ResponseMessageType.PONG, "203.0.113.1", 32100, losingSocket);
    expect(built.pathAnswering).toBe(false);
  });

  it("retains a pre-connect PONG cookie without counting it as path evidence", () => {
    const { built, internals } = session();
    const cookie = Buffer.from("synthetic-cookie");
    internals.connected = false;
    receive(built, ResponseMessageType.PONG, "203.0.113.1", 32100, undefined, cookie);
    expect(built.pathSilentMs).toBeUndefined();
    internals.connected = true;
    expect(internals.lastPongData).toEqual(cookie);
  });

  it("answers that a path with no post-connect peer traffic is not known to be dead", () => {
    const { built } = session();
    expect(built.pathAnswering).toBe(true);
  });

  it("states the silence once, rather than on every heartbeat", () => {
    const { built, internals, debug } = session();
    internals.lastPeerAt = Date.now() - 16_000;
    void built.pathAnswering;
    void built.pathAnswering;
    const stale = traces(debug).filter((t) => (t as { phase: string }).phase === "path-stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ phase: "path-stale" });
  });
});
