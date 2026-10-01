import { afterEach, describe, expect, it, vi } from "vitest";
import { EufyMega } from "../eufy-mega.js";
import type { CommandContext } from "../../model/capabilities/types.js";
import { buildCommand } from "../../model/capabilities/index.js";
import { noopLogger } from "../../core/logger.js";

afterEach(() => vi.restoreAllMocks());

describe("camera power context", () => {
  it.each(["parent_sn", "station_sn"])(
    "uses the resolved station when raw topology is carried by %s",
    async (stationKey) => {
      const info = vi.fn();
      const client = new EufyMega({ email: "t@example.com", password: "x", logger: { ...noopLogger, info } });
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
        raw: { [stationKey]: stationSn, device_channel: 3, main_sw_version: "2.3.1.0" },
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
      expect(info).toHaveBeenCalledWith(
        "[context] T8410 power-v2 type=31 channel=3 stationModel=T8030 firmware=2.3.1.0 reported1035=0 reported2001=absent",
      );
      expect(info.mock.calls.flat().join(" ")).not.toContain(sn);
      expect(info.mock.calls.flat().join(" ")).not.toContain(stationSn);
    },
  );
});
