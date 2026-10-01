import { describe, expect, it } from "vitest";
import { CAMERA_CMD, CAMERA_MEMBERS, type CameraActions } from "../camera.js";
import { buildCommand } from "../index.js";
import { DeviceType } from "../../device-types.js";
import { Device } from "../../device.js";
import type { CommandContext } from "../types.js";
import { bind } from "./bind.js";

const context = (extra: Partial<CommandContext> = {}): CommandContext => ({
  codec: "camera",
  deviceType: DeviceType.INDOOR_PT_CAMERA,
  model: "T8410",
  channel: 3,
  homeBaseAttached: true,
  stationSerial: "T8030P0000000000",
  firmwareVersion: "2.3.1.0",
  paramIds: new Set([CAMERA_CMD.CAMERA_ENABLE]),
  capabilities: new Set(["camera"]),
  ...extra,
});

describe("indoor camera power on HomeBase 3", () => {
  it.each([true, false])("wraps enabled=%s with the disable-bit switch and camera channel", (enabled) => {
    expect(buildCommand("enabled", enabled, context())).toEqual({
      kind: "set-payload",
      cmd: 6250,
      payload: { switch: enabled ? 0 : 1 },
      channel: 3,
      mValue3: 0,
      form: undefined,
    });
  });

  it("routes the bound setter and on/off aliases through the same payload", async () => {
    const { acts, sent } = bind<CameraActions>("camera", context());
    await acts.setEnabled(false);
    await acts.on();
    await acts.off();
    expect(sent.map((command) => command.kind)).toEqual(["set-payload", "set-payload", "set-payload"]);
    expect(sent).toMatchObject([{ payload: { switch: 1 } }, { payload: { switch: 0 } }, { payload: { switch: 1 } }]);
  });

  it.each(["2.3.1", "2.3.1.1", "2.3.10.0", "2.4.0.0", "3.0.0.0"])("accepts firmware %s", (firmwareVersion) => {
    expect(buildCommand("enabled", false, context({ firmwareVersion }))).toMatchObject({ kind: "set-payload" });
  });

  it.each(["2.3.0.9", "2.2.9.9", "1.9.9.9", undefined, "", "unknown"])(
    "retains the scalar route for firmware %s",
    (firmwareVersion) => {
      expect(buildCommand("enabled", false, context({ firmwareVersion }))).toMatchObject({
        kind: "set-param",
        param: CAMERA_CMD.CAMERA_ENABLE,
        value: 0,
        channel: 3,
      });
    },
  );

  it.each([
    { homeBaseAttached: false },
    { homeBaseAttached: undefined },
    { stationSerial: undefined },
    { stationSerial: "T8010P0000000000" },
    { deviceType: DeviceType.INDOOR_COST_DOWN_CAMERA },
    { deviceType: DeviceType.INDOOR_PT_CAMERA_S350 },
    { deviceType: DeviceType.CAMERA2 },
  ])("retains the scalar route for an unrelated or unknown topology/family %j", (extra) => {
    expect(buildCommand("enabled", false, context(extra))).toMatchObject({ kind: "set-param" });
  });

  it.each([true, false])("confirms enabled=%s using the reported disable bit", (enabled) => {
    expect(CAMERA_MEMBERS.enabled.observation.reflects(enabled, context())).toEqual({
      param: CAMERA_CMD.CAMERA_ENABLE,
      expected: enabled ? 0 : 1,
      observed: enabled,
    });
    const device = Device.fromRecord("T8410P0000000000", {
      deviceType: DeviceType.INDOOR_PT_CAMERA,
      model: "T8410",
      category: "eufy_security",
      parentSn: "T8030P0000000000",
      params: { [CAMERA_CMD.CAMERA_ENABLE]: enabled ? "0" : "1" },
    });
    expect(device.getProperty("enabled")?.value).toBe(enabled);
  });

  it("keeps the direct OPEN_DEVICE readback when reported", () => {
    const ctx = context({ paramIds: new Set([1035, 2001]) });
    expect(CAMERA_MEMBERS.enabled.observation.reflects(false, ctx)).toEqual({
      param: 2001,
      expected: false,
      observed: false,
    });
  });

  it("does not invent an enablement readback from a privacy-only report", () => {
    expect(CAMERA_MEMBERS.enabled.observation.reflects(false, context({ paramIds: new Set([6250]) }))).toBeUndefined();
  });
});
