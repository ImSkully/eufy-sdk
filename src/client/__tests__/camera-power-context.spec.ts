import { afterEach, describe, expect, it, vi } from "vitest";
import { EufyMega } from "../eufy-mega.js";
import type { CommandContext } from "../../model/capabilities/types.js";
import { buildCommand } from "../../model/capabilities/index.js";

afterEach(() => vi.restoreAllMocks());

describe("camera power context", () => {
  it("carries the covering station, firmware and channel from the device record into power routing", async () => {
    const client = new EufyMega({ email: "t@example.com", password: "x" });
    const sn = "T8410P0000000000";
    const stationSn = "T8030P0000000000";
    const internal = client as any;
    vi.spyOn(internal.registry, "record").mockResolvedValue({
      deviceType: 31,
      model: "T8410",
      category: "eufy_security",
      parentSn: stationSn,
      params: { 1035: "0" },
    });
    vi.spyOn(internal.registry, "require").mockReturnValue({
      sn,
      category: "eufy_security",
      raw: { parent_sn: stationSn, device_channel: 3, main_sw_version: "2.3.1.0" },
    });
    const ctx: CommandContext = await internal.commandContext(sn);
    expect(ctx).toMatchObject({
      stationSerial: stationSn,
      homeBaseAttached: true,
      firmwareVersion: "2.3.1.0",
      channel: 3,
    });
    expect(buildCommand("enabled", false, ctx)).toMatchObject({
      kind: "set-payload",
      cmd: 6250,
      payload: { switch: 1 },
      channel: 3,
    });
  });
});
