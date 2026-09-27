import { cameraPowerTier } from "../battery.js";
import { Device } from "../../device.js";
import { resolveDevice } from "../../registry.js";
import { bind } from "./bind.js";
import { EufyMega } from "../../../client/eufy-mega.js";
import type { CameraActions } from "../camera.js";
import type { CommandContext } from "../types.js";
import type { Capability } from "../../types.js";
import type { MediaProvider } from "../../../core/contracts.js";
import type { EufyDevice } from "../../../core/types.js";

/**
 * A confirmed mains-only camera can still report battery-family parameters. Its stream and standalone
 * session use the wired tier, and physical-cell readings remain withheld.
 */
const SN = "T84A1P0000000001";
const BATTERY_CAPS = new Set<Capability>(["camera", "battery"]);

describe("mains-only camera power tier", () => {
  it("classifies T84A1 as wired even with the battery capability resolved", () => {
    expect(cameraPowerTier("T84A1", BATTERY_CAPS)).toBe("wired");
    expect(cameraPowerTier(SN, BATTERY_CAPS)).toBe("wired");
    expect(cameraPowerTier("T8423", BATTERY_CAPS)).toBe("wired");
    // A real battery camera is still budgeted, and a camera without the capability never is.
    expect(cameraPowerTier("T8114P0000000001", BATTERY_CAPS)).toBe("battery");
    expect(cameraPowerTier("T8114P0000000001", new Set(["camera"]))).toBe("wired");
  });

  it.each(["T84A1", "T8423"])("gives %s media egresses the wired tier", async (model) => {
    const seen: string[] = [];
    const media: MediaProvider = {
      snapshotLive: async (opts) => {
        seen.push(opts?.powered ?? "missing");
        return { jpeg: Buffer.alloc(0), width: 1, height: 1 };
      },
      live: async (opts) => (seen.push(opts?.powered ?? "missing"), {}) as never,
      record: async () => Buffer.alloc(0),
    };
    const ctx: CommandContext = {
      channel: 0,
      codec: "camera",
      model,
      paramIds: new Set<number>([1101]),
      capabilities: BATTERY_CAPS,
    };
    const { acts } = bind<CameraActions>("camera", ctx, { media });
    await acts.snapshotLive!();
    await acts.live!();
    expect(seen).toEqual(["wired", "wired"]);
  });

  it("resolves by name and withholds the sentinel battery level", () => {
    const record = { deviceType: 30, model: "T84A1", params: { 1101: "100" } };
    expect(resolveDevice(record).name).toBe("Wall Light Cam S100");
    const dev = Device.fromRecord(SN, record);
    expect(dev.getProperty("battery")).toBeUndefined();
  });

  it.each(["T84A1", "T8423"])("keeps a standalone %s P2P session on the wired tier", (model) => {
    const eufy = new EufyMega({ email: "synthetic@example.com", password: "synthetic", autoRealtime: false });
    const sn = `${model}P0000000001`;
    const device = {
      sn,
      stationSn: sn,
      model,
      category: "eufy_security",
      deviceClass: "camera",
      params: { 1101: "100" },
      raw: {},
    } as unknown as EufyDevice;
    vi.spyOn((eufy as any).registry, "list").mockReturnValue([device]);
    expect((eufy as any).stationPower(sn)).toBe("wired");
  });
});
