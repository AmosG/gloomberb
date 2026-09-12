import { expect, test } from "bun:test";
import { ApiRequestError } from "../../../api-client/errors";
import { decodeRpcResponse, decodeRpcValue, encodeRpcResponse, encodeRpcValue } from "./rpc-codec";

// Load Electrobun's actual transport core without starting its window/socket entrypoint.
const { createRPC } = await import(new URL("../shared/rpc.ts", import.meta.resolve("electrobun/view")).href);

function requestThroughRpc(load: () => unknown | Promise<unknown>, encode = encodeRpcResponse) {
  let receiveClient: (packet: unknown) => void;
  let receiveServer: (packet: unknown) => void;
  const client = createRPC({ maxRequestTime: 1000 });
  const server = createRPC({ requestHandler: { "backend.request": () => encode(load) } });
  client.setTransport({
    registerHandler: (handler: typeof receiveClient) => { receiveClient = handler; },
    send: (packet: unknown) => { queueMicrotask(() => receiveServer(JSON.parse(JSON.stringify(packet)))); },
  });
  server.setTransport({
    registerHandler: (handler: typeof receiveServer) => { receiveServer = handler; },
    send: (packet: unknown) => { queueMicrotask(() => receiveClient(JSON.parse(JSON.stringify(packet)))); },
  });
  return client.request["backend.request"]({ method: "capability.invoke", payload: null }).then(decodeRpcResponse);
}

test.each([401, 402, 403, 429, 503, undefined])("API error %s survives Electrobun's JSON transport", async (status) => {
  const failure = await requestThroughRpc(() => { throw new ApiRequestError("Controlled provider failure", status, 2000); }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiRequestError);
  expect(failure.message).toBe("Controlled provider failure");
  expect(failure.status).toBe(status);
  expect(failure.retryAfterMs).toBe(2000);
});

test("successful research preserves dates, maps, nulls and response-shaped payloads", async () => {
  const value = {
    dated: new Date("2026-09-12T00:00:00Z"),
    nested: new Map([["symbol", { observations: [null, 0, 12.34] }]]),
    __gloomRpcResponse: 1, ok: false, error: { message: "This is legitimate data", status: 403 },
  };
  expect(await requestThroughRpc(() => value)).toEqual(value);
  expect(await requestThroughRpc(() => null)).toBeNull();
  expect(await requestThroughRpc(() => undefined)).toBeUndefined();
  expect(decodeRpcResponse(encodeRpcValue(value.nested))).toEqual(value.nested);
  expect(decodeRpcValue(encodeRpcValue(value.dated))).toEqual(value.dated);
});

test("generic failures retain their message without inventing API status", async () => {
  const failure = await requestThroughRpc(() => { throw new Error("Research source timed out"); }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(ApiRequestError);
  expect(failure.message).toBe("Research source timed out");
  expect(failure.status).toBeUndefined();
});

test("malformed response metadata cannot become a trusted API rejection", () => {
  for (const error of [null, {}, { message: 42 }, { message: "x", status: "403" }, { message: "x", status: 0 }, { message: "x", retryAfterMs: -1 }]) {
    try {
      decodeRpcResponse({ __gloomRpcResponse: 1, ok: false, error });
      throw new Error("Expected a malformed-response rejection");
    } catch (failure) {
      expect(failure).not.toBeInstanceOf(ApiRequestError);
      expect((failure as Error).message).toBe("Invalid desktop response");
    }
  }
  expect(() => decodeRpcResponse({ __gloomRpcResponse: 2, ok: true, value: 42 })).toThrow("Unsupported desktop response");
});
