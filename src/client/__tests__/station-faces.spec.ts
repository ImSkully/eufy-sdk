import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { EufyMega } from "../eufy-mega.js";

/**
 * `getStationFaces` reads the station's own `person_basic_info` table over P2P — the roster an
 * account that keeps its faces on the station never uploaded, so the cloud answers empty for it.
 *
 * The station streams the table as `CMD_DATABASE` frames whose decrypted text is a FRAGMENT of one
 * JSON document, carrying no index, no total and no terminator. The document's own structure is
 * therefore the only completion signal in the stream, which is what these pin: a parse that succeeds
 * had every byte, a truncated accumulation cannot masquerade as a whole one, and a reply that never
 * completes times out rather than answering a partial table.
 *
 * A fake session stands in for the transport. It is an EventEmitter with the one method the read
 * drives, which is all `collectDbTable` touches — the specs never open a socket.
 */
class FakeSession extends EventEmitter {
  requested = 0;
  chunks: string[] = [];
  requestFaces(): void {
    this.requested += 1;
    for (const text of this.chunks) this.emit("dbChunk", { stationSn: STATION, text });
  }
}

const STATION = "T8010P0000000000";

/**
 * Drive the read against a fake station, with the registry and the P2P layer stubbed to the one
 * station and the one session. `raw.member.admin_user_id` is what the station scopes the query to;
 * a synthetic value stands in for it.
 */
function harness(chunks: string[], opts: { adminUserId?: string; session?: FakeSession | null } = {}) {
  const eufy = new EufyMega({ email: "t@example.com", password: "x" });
  const session = opts.session === undefined ? new FakeSession() : opts.session;
  if (session) session.chunks = chunks;

  const internals = eufy as unknown as {
    registry: { list: () => unknown[] };
    p2p: {
      stationKeyOf: (sn: string) => string;
      ensureStation: (sn: string) => Promise<void>;
      getSessions: () => Map<string, unknown>;
    };
  };
  vi.spyOn(internals.registry, "list").mockReturnValue([
    {
      sn: STATION,
      raw: { member: { admin_user_id: opts.adminUserId ?? "ADMIN-0000" } },
    },
  ]);
  internals.p2p = {
    stationKeyOf: (sn: string) => sn,
    ensureStation: async () => undefined,
    getSessions: () => new Map(session ? [[STATION, session]] : []),
  };
  return { eufy, session };
}

/** The table as the station wraps it, split so no fragment is valid JSON on its own. */
const TABLE = JSON.stringify({
  cmd: 10000,
  count: 2,
  data: [
    { person_id: 1, name: "Alex", relation: 0 },
    { person_id: 2, name: "stranger1", relation: 0 },
  ],
});

describe("getStationFaces", () => {
  it("answers the table once the fragments form one whole document", async () => {
    const mid = Math.floor(TABLE.length / 2);
    const { eufy, session } = harness([TABLE.slice(0, mid), TABLE.slice(mid)]);
    const faces = await eufy.getStationFaces(STATION);
    expect(faces.map((f) => f.name)).toEqual(["Alex", "stranger1"]);
    expect(faces[0]!.person_id).toBe(1);
    expect(session!.requested).toBe(1);
  });

  it("keeps the station's own placeholder names rather than filtering them", async () => {
    // `stranger<n>` is what the station calls a face nobody has named. Dropping it here would hide
    // that the row exists at all, and naming it is the caller's decision, not this read's.
    const { eufy } = harness([TABLE]);
    expect((await eufy.getStationFaces(STATION)).map((f) => f.name)).toContain("stranger1");
  });

  it("keeps a column this shape does not name", async () => {
    const extra = JSON.stringify({ data: [{ person_id: 3, name: "Sam", group_id: 7, face_count: 4 }] });
    const [face] = await harness([extra]).eufy.getStationFaces(STATION);
    expect(face).toMatchObject({ person_id: 3, group_id: 7, face_count: 4 });
  });

  it("does not answer a truncated table as a complete one", async () => {
    // The whole point of parsing to decide completion: a fragment that stops mid-document is not
    // valid JSON, so it cannot resolve, and the read times out instead of reporting half a household.
    const { eufy } = harness([TABLE.slice(0, TABLE.length - 10)]);
    await expect(eufy.getStationFaces(STATION, { timeoutMs: 20 })).rejects.toThrow(/no complete reply/);
  });

  it("answers an empty list for a station with nobody enrolled", async () => {
    const { eufy } = harness([JSON.stringify({ cmd: 10000, count: 0, data: [] })]);
    expect(await eufy.getStationFaces(STATION)).toEqual([]);
  });

  it("ignores a chunk belonging to another station", async () => {
    const { eufy, session } = harness([]);
    const read = eufy.getStationFaces(STATION, { timeoutMs: 40 });
    session!.emit("dbChunk", { stationSn: "T8010P0000000001", text: TABLE });
    await expect(read).rejects.toThrow(/no complete reply/);
  });

  it("refuses a station whose record states no admin id, rather than querying with none", async () => {
    // A wrong or absent account id is answered `-104` by the station, which looks like silence.
    const { eufy } = harness([TABLE], { adminUserId: "" });
    await expect(eufy.getStationFaces(STATION)).rejects.toThrow(/admin_user_id/);
  });

  it("refuses when the station has no session to ask", async () => {
    const { eufy } = harness([], { session: null });
    await expect(eufy.getStationFaces(STATION)).rejects.toThrow(/no P2P session/);
  });

  it("stops listening once it has answered", async () => {
    const { eufy, session } = harness([TABLE]);
    await eufy.getStationFaces(STATION);
    expect(session!.listenerCount("dbChunk")).toBe(0);
  });

  it("stops listening when it gives up", async () => {
    const { eufy, session } = harness(["{ not json"]);
    await expect(eufy.getStationFaces(STATION, { timeoutMs: 20 })).rejects.toThrow();
    expect(session!.listenerCount("dbChunk")).toBe(0);
  });

  it("gives up when the caller aborts", async () => {
    const control = new AbortController();
    const { eufy } = harness([]);
    const read = eufy.getStationFaces(STATION, { signal: control.signal });
    control.abort();
    await expect(read).rejects.toThrow(/aborted/);
  });
});
