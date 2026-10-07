import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { createWardClient } from "./client.js";
import { WardConfigurationError, WardUnavailableError } from "./errors.js";
import { createNotifier } from "./notify.js";

/**
 * `sendNotification` against a real local HTTP server, not a mocked `fetch`,
 * like the rest of this package's tests. The server records what it received
 * and answers whatever the test tells it to.
 */

const TEST_APP_KEY = "wak_test_key_for_this_suite";

interface Received {
  method: string | undefined;
  url: string | undefined;
  appKey: string | undefined;
  contentType: string | undefined;
  body: unknown;
}

interface FakeNotify {
  origin: string;
  url: URL;
  received: Received[];
  /** The next answers, in order. The last one repeats. */
  answer(status: number, body: string): void;
  /** Accept connections and never answer. */
  hang(): void;
  close(): Promise<void>;
}

let server: FakeNotify | undefined;

async function startFakeNotify(path = "/notify"): Promise<FakeNotify> {
  const received: Received[] = [];
  let status = 200;
  let body = '{"sent":true}';
  let hanging = false;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const appKey = req.headers["x-ward-app-key"];
    received.push({
      method: req.method,
      url: req.url,
      appKey: typeof appKey === "string" ? appKey : undefined,
      contentType: req.headers["content-type"],
      body: raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined,
    });
    if (hanging) return;
    res.writeHead(req.url === path ? status : 404, { "content-type": "application/json" });
    res.end(req.url === path ? body : '{"error":"not found"}');
  }

  const http: Server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(500);
      res.end(String(error));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;

  return {
    origin,
    url: new URL(path, origin),
    received,
    answer(nextStatus, nextBody) {
      status = nextStatus;
      body = nextBody;
    },
    hang() {
      hanging = true;
    },
    async close() {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const input = {
  subject: "0123456789abcdef0123456789abcdef",
  mailSubject: "Mâine: concert la Filarmonică",
  text: "Evenimentul începe la ora 19:00.",
};

describe("sendNotification", () => {
  it("posts the three fields with the app key and returns { sent: true }", async () => {
    server = await startFakeNotify();
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    await expect(send(input)).resolves.toEqual({ sent: true });

    expect(server.received).toEqual([
      {
        method: "POST",
        url: "/notify",
        appKey: TEST_APP_KEY,
        contentType: "application/json",
        body: input,
      },
    ]);
  });

  it("sends only the three fields, whatever else the caller's object carries", async () => {
    server = await startFakeNotify();
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    await send({ ...input, from: "boss@example.com" } as typeof input);

    expect(server.received[0]!.body).toEqual(input);
  });

  it("returns { sent: false } for a refusal, without throwing", async () => {
    server = await startFakeNotify();
    server.answer(200, '{"sent":false}');
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    await expect(send(input)).resolves.toEqual({ sent: false });
  });

  it("throws WardConfigurationError on a 401, naming WARD_APP_KEY", async () => {
    server = await startFakeNotify();
    server.answer(401, '{"error":"invalid_app_key"}');
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    const error = await send(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WardConfigurationError);
    // Still a WardUnavailableError, so existing handling catches it.
    expect(error).toBeInstanceOf(WardUnavailableError);
    expect((error as Error).message).toContain("WARD_APP_KEY");
  });

  it("throws WardUnavailableError when Ward cannot send (503)", async () => {
    server = await startFakeNotify();
    server.answer(503, '{"error":"mail_unavailable"}');
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    const error = await send(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WardUnavailableError);
    expect(error).not.toBeInstanceOf(WardConfigurationError);
  });

  it("throws WardUnavailableError on a network failure", async () => {
    server = await startFakeNotify();
    const url = server.url;
    await server.close();
    server = undefined;
    const send = createNotifier({ notifyUrl: url, appKey: TEST_APP_KEY });

    await expect(send(input)).rejects.toBeInstanceOf(WardUnavailableError);
  });

  it("throws WardUnavailableError on a timeout", async () => {
    server = await startFakeNotify();
    server.hang();
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY, timeoutMs: 50 });

    await expect(send(input)).rejects.toBeInstanceOf(WardUnavailableError);
  });

  it.each([
    ["not JSON", "<html>"],
    ["no sent field", '{"ok":true}'],
    ["a sent field that is not a boolean", '{"sent":"yes"}'],
    ["null", "null"],
  ])("throws WardUnavailableError on a 200 with %s", async (_, body) => {
    server = await startFakeNotify();
    server.answer(200, body);
    const send = createNotifier({ notifyUrl: server.url, appKey: TEST_APP_KEY });

    await expect(send(input)).rejects.toBeInstanceOf(WardUnavailableError);
  });
});

describe("createWardClient().sendNotification", () => {
  it("posts to <apiBasePath>/notify on Ward's origin", async () => {
    server = await startFakeNotify("/ward-api/notify");
    const ward = createWardClient({
      publicOrigin: server.origin,
      apiBasePath: "/ward-api",
      appKey: TEST_APP_KEY,
    });

    await expect(ward.sendNotification(input)).resolves.toEqual({ sent: true });
    expect(server.received[0]).toMatchObject({ url: "/ward-api/notify", appKey: TEST_APP_KEY });
  });
});
