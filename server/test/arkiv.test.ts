import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig, tinybarsToHbar } from "../src/config.js";
import { AppError, redactProcessSecrets } from "../src/errors.js";
import { createArkivService, redactSecrets } from "../src/integrations/arkiv.js";
import { normalizeAgentInput, parseAgentRows, prepareAgentBodySchema, type RawAgentRow } from "../src/schemas/agent.js";
import { arkivStr, decodeDataJson, encodeDataJson, evmAddressSchema, utf8Bytes } from "../src/schemas/arkiv.js";
import { BASE_TEST_ENV, FAKE_CREDENTIALS } from "./helpers.js";

/**
 * Unit tests. Nothing from Arkiv is mocked: these cover our own validation and parsing, and the
 * service checks that must fail before any request is sent. Real Arkiv behavior is in test/live/.
 */

describe("Arkiv str columns are capped at 128 bytes", () => {
  it("accepts exactly 128 bytes and rejects 129 (ASCII)", () => {
    assert.equal(arkivStr.safeParse("a".repeat(128)).success, true);
    assert.equal(arkivStr.safeParse("a".repeat(129)).success, false);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const twoByte = "é".repeat(64); // 64 characters, 128 bytes
    assert.equal(utf8Bytes(twoByte), 128);
    assert.equal(arkivStr.safeParse(twoByte).success, true);
    assert.equal(arkivStr.safeParse(`${twoByte}a`).success, false);
  });

  it("the service rejects a 129-byte column before any write is sent", async () => {
    // Fake placeholder credentials: if validation did not stop this, the call would fail at the network instead.
    const arkiv = createArkivService(loadConfig({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS }));
    await assert.rejects(
      arkiv.writeTaskRecord({
        taskId: "t".repeat(129),
        status: "planning",
        data: { category: "research", budgetCapTinybars: "20000000", createdAt: 1 },
      }),
      (err: unknown) => err instanceof Error && err.name === "ZodError" && /128 bytes/.test(err.message),
    );
    await assert.rejects(
      arkiv.createAgentListing({
        agentId: "a".repeat(129),
        category: "other",
        data: { name: "Test", description: "x", skills: [], priceTinybars: "1", currency: "HBAR", createdAt: 1 },
      }),
      (err: unknown) => err instanceof Error && err.name === "ZodError" && /128 bytes/.test(err.message),
    );
  });

  it("writes need the server key", async () => {
    const { ARKIV_SERVER_PRIVATE_KEY: _k, ...creds } = FAKE_CREDENTIALS;
    const arkiv = createArkivService(loadConfig({ ...BASE_TEST_ENV, ...creds }));
    assert.equal(arkiv.serverAddress, undefined);
    await assert.rejects(
      arkiv.writeTaskRecord({
        taskId: "t1",
        status: "planning",
        data: { category: "research", budgetCapTinybars: "1", createdAt: 1 },
      }),
      (err: unknown) => err instanceof AppError && err.code === "ARKIV_WRITE_NOT_CONFIGURED",
    );
  });
});

describe("server key and address handling", () => {
  it("rejects a key that passes the format check but is not a valid secp256k1 key, without echoing it", () => {
    for (const badKey of ["0x" + "00".repeat(32), "0x" + "ff".repeat(32)]) {
      assert.throws(
        () => createArkivService(loadConfig({ ...BASE_TEST_ENV, ...FAKE_CREDENTIALS, ARKIV_SERVER_PRIVATE_KEY: badKey })),
        (err: unknown) =>
          err instanceof AppError &&
          err.code === "ARKIV_KEY_INVALID" &&
          !err.message.includes("0000") &&
          !err.message.includes("ffff") &&
          !/\d{10,}/.test(err.message), // viem would print the key as a long decimal number
      );
    }
  });

  it("normalizes addresses to checksummed form, even with a wrong-checksum mixed case", () => {
    const checksummed = "0xCd6e8eC1A0F773C5B2202D083B022d1172ec9184";
    assert.equal(evmAddressSchema.parse(checksummed.toLowerCase()), checksummed);
    assert.equal(evmAddressSchema.parse("0xcD6E8eC1A0F773C5B2202D083B022d1172ec9184"), checksummed);
    assert.equal(evmAddressSchema.safeParse("0x123").success, false);
  });

  it("requires access keys long enough to be redacted reliably", () => {
    assert.throws(() => loadConfig({ ...BASE_TEST_ENV, ARKIV_ACCESS_KEY: "short" }), /ARKIV_ACCESS_KEY must be at least 16/);
  });
});

describe("listing validation on read", () => {
  const goodRow = (key: string): RawAgentRow => ({
    entityKey: key,
    owner: "0x" + "1".repeat(40),
    creator: "0x" + "1".repeat(40),
    expiresAt: 1_000_000n,
    agentId: "research",
    category: "research",
    data: {
      name: "Research Agent",
      description: "Finds and summarizes information on a topic.",
      skills: ["summaries"],
      priceTinybars: "5000000",
      currency: "HBAR",
      createdAt: 1_700_000_000,
    },
  });

  it("skips malformed entities and counts them", () => {
    const rows: RawAgentRow[] = [
      goodRow("0x" + "a".repeat(64)),
      { ...goodRow("0x" + "b".repeat(64)), data: undefined }, // data was not valid JSON
      { ...goodRow("0x" + "c".repeat(64)), category: "spam" }, // not a known category
      { ...goodRow("0x" + "d".repeat(64)), data: { ...goodRow("x").data as object, priceTinybars: "-5" } },
      { ...goodRow("0x" + "e".repeat(64)), data: { ...goodRow("x").data as object, extra: "field" } },
    ];
    const { agents, invalid } = parseAgentRows(rows);
    assert.equal(agents.length, 1);
    assert.equal(invalid, 4);
    assert.equal(agents[0]?.entityKey, "0x" + "a".repeat(64));
    assert.equal(agents[0]?.priceHbar, "0.05");
  });

  it("decodes only valid hex holding valid UTF-8 JSON", () => {
    const hex = "0x" + Buffer.from(encodeDataJson({ a: 1 })).toString("hex");
    assert.deepEqual(decodeDataJson(hex), { a: 1 });
    assert.equal(decodeDataJson("0x" + Buffer.from("not json").toString("hex")), undefined);
    assert.equal(decodeDataJson("0xzz"), undefined);
    assert.equal(decodeDataJson("0x" + "ff".repeat(4)), undefined); // invalid UTF-8
  });

  it("refuses to encode data over the 4 KB cap", () => {
    assert.throws(() => encodeDataJson({ blob: "x".repeat(5000) }), /larger than 4096 bytes/);
  });
});

describe("prepare normalization", () => {
  it("derives the slug, converts price to tinybars, and keeps owner and expiry out of the data", () => {
    const body = prepareAgentBodySchema.parse({
      name: "  My Pricing Bot  ",
      description: "Compares prices.",
      category: "analysis",
      skills: ["pricing", " comparison "],
      pricePerTask: "0.03",
    });
    const listing = normalizeAgentInput(body, 1_700_000_000);
    assert.deepEqual(listing, {
      agentId: "my-pricing-bot",
      category: "analysis",
      data: {
        name: "My Pricing Bot",
        description: "Compares prices.",
        skills: ["pricing", "comparison"],
        priceTinybars: "3000000",
        currency: "HBAR",
        createdAt: 1_700_000_000,
      },
    });
  });
});

describe("helpers", () => {
  it("redacts the access key and private key in every form", () => {
    const config = { ARKIV_ACCESS_KEY: "ark_test_abc/def+ghi", ARKIV_SERVER_PRIVATE_KEY: "0x" + "ef".repeat(32) };
    const message = `URL: https://rpc.example/${encodeURIComponent(config.ARKIV_ACCESS_KEY)} key ${config.ARKIV_ACCESS_KEY} pk ${"ef".repeat(32)}`;
    const redacted = redactSecrets(message, config);
    assert.ok(!redacted.includes("ark_test"));
    assert.ok(!redacted.includes("efef"));
    assert.match(redacted, /\[redacted\]/);
  });

  it("redacts every secret set in process.env from log lines", () => {
    const saved = process.env.OG_API_KEY;
    process.env.OG_API_KEY = "sk-test-redaction-placeholder";
    try {
      const line = redactProcessSecrets("failed: GET https://x.example/?key=sk-test-redaction-placeholder");
      assert.ok(!line.includes("sk-test-redaction"));
    } finally {
      if (saved === undefined) delete process.env.OG_API_KEY;
      else process.env.OG_API_KEY = saved;
    }
  });

  it("formats tinybars as HBAR", () => {
    assert.equal(tinybarsToHbar(5_000_000n), "0.05");
    assert.equal(tinybarsToHbar(100_000_000n), "1");
    assert.equal(tinybarsToHbar(1n), "0.00000001");
    assert.equal(tinybarsToHbar(0n), "0");
  });
});
