import { afterEach, describe, expect, it, vi } from "vitest";

import { MegaHttpClient } from "../mega-client.js";

type MegaInternals = {
  post: (service: string, path: string, body: unknown) => Promise<unknown>;
  securityAppPost: (path: string, body: Record<string, unknown>) => Promise<unknown>;
};

function makeClient(): { mega: MegaHttpClient; internals: MegaInternals } {
  const mega = new MegaHttpClient({
    email: "synthetic@example.invalid",
    password: "synthetic",
    countryCode: "US",
    region: "us-pr",
  });

  return {
    mega,
    internals: mega as unknown as MegaInternals,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MegaHttpClient push registration", () => {
  it("registers the same FCM token with Mega and Security, then checks Security push", async () => {
    const { mega, internals } = makeClient();

    const post = vi.fn(async () => undefined);
    const securityAppPost = vi.fn(async () => undefined);

    internals.post = post;
    internals.securityAppPost = securityAppPost;

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    await mega.registerPushToken("synthetic-fcm-token");

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith("push", "/app/push/register_push_token", {
      is_notification_enable: true,
      token: "synthetic-fcm-token",
      voip_token: "",
    });

    expect(securityAppPost).toHaveBeenCalledTimes(2);
    expect(securityAppPost).toHaveBeenNthCalledWith(1, "/v1/apppush/register_push_token", {
      is_notification_enable: true,
      token: "synthetic-fcm-token",
      transaction: "1700000000000",
    });
    expect(securityAppPost).toHaveBeenNthCalledWith(2, "/v1/app/review/app_push_check", {
      app_type: "eufySecurity",
      transaction: "1700000000000",
    });
  });

  it("waits for each registration step before starting the next", async () => {
    const { mega, internals } = makeClient();
    const megaRegistration = deferred();
    const securityRegistration = deferred();

    const post = vi.fn(() => megaRegistration.promise);
    const securityAppPost = vi.fn((path: string) => {
      if (path === "/v1/apppush/register_push_token") {
        return securityRegistration.promise;
      }
      return Promise.resolve();
    });

    internals.post = post;
    internals.securityAppPost = securityAppPost;

    const registration = mega.registerPushToken("synthetic-fcm-token");

    expect(post).toHaveBeenCalledOnce();
    expect(securityAppPost).not.toHaveBeenCalled();

    megaRegistration.resolve();
    await Promise.resolve();

    expect(securityAppPost).toHaveBeenCalledTimes(1);
    expect(securityAppPost).toHaveBeenCalledWith("/v1/apppush/register_push_token", expect.any(Object));

    securityRegistration.resolve();
    await registration;

    expect(securityAppPost).toHaveBeenCalledTimes(2);
    expect(securityAppPost).toHaveBeenNthCalledWith(2, "/v1/app/review/app_push_check", expect.any(Object));
  });

  it("stops when Mega registration fails", async () => {
    const { mega, internals } = makeClient();
    const failure = new Error("Mega registration failed");

    const post = vi.fn(async () => {
      throw failure;
    });
    const securityAppPost = vi.fn(async () => undefined);

    internals.post = post;
    internals.securityAppPost = securityAppPost;

    await expect(mega.registerPushToken("synthetic-fcm-token")).rejects.toBe(failure);

    expect(post).toHaveBeenCalledOnce();
    expect(securityAppPost).not.toHaveBeenCalled();
  });

  it("stops before the push check when Security registration fails", async () => {
    const { mega, internals } = makeClient();
    const failure = new Error("Security registration failed");

    const post = vi.fn(async () => undefined);
    const securityAppPost = vi.fn(async (path: string) => {
      if (path === "/v1/apppush/register_push_token") {
        throw failure;
      }
      return undefined;
    });

    internals.post = post;
    internals.securityAppPost = securityAppPost;

    await expect(mega.registerPushToken("synthetic-fcm-token")).rejects.toBe(failure);

    expect(post).toHaveBeenCalledOnce();
    expect(securityAppPost).toHaveBeenCalledTimes(1);
  });

  it("rejects when the Security push check fails", async () => {
    const { mega, internals } = makeClient();
    const failure = new Error("Security push check failed");

    const post = vi.fn(async () => undefined);
    const securityAppPost = vi.fn(async (path: string) => {
      if (path === "/v1/app/review/app_push_check") {
        throw failure;
      }
      return undefined;
    });

    internals.post = post;
    internals.securityAppPost = securityAppPost;

    await expect(mega.registerPushToken("synthetic-fcm-token")).rejects.toBe(failure);

    expect(post).toHaveBeenCalledOnce();
    expect(securityAppPost).toHaveBeenCalledTimes(2);
  });
});
