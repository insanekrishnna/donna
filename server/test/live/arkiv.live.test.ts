import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ExpirationTime } from "@arkiv-network/sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Config, ConfigError, loadConfig, loadLocalEnvFile } from "../../src/config.js";
import { AppError } from "../../src/errors.js";
import {
  type ArkivService,
  createArkivClients,
  createArkivService,
  describeArkivError,
} from "../../src/integrations/arkiv.js";
import { AgentListing, TaskRecord } from "../../src/schemas/arkiv.js";
import { startTestServer } from "../helpers.js";

/**
 * Live tests against the real Arkiv Rabdi testnet. Nothing is mocked.
 * Run: npm run test:live. Skipped when ARKIV_ACCESS_KEY or ARKIV_SERVER_PRIVATE_KEY is absent.
 * Every entity written here expires after 1 hour. Logs print only public values.
 */
loadLocalEnvFile();
// A config error is reported in the skip reason (variable names and rules only, never values),
// so a broken .env is never mistaken for "keys not set".
let configProblems: string[] = [];
const config: Config | undefined = (() => {
  try {
    return loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) configProblems = err.problems;
    else throw err;
    return undefined;
  }
})();
const skip = !config
  ? `config is invalid: ${configProblems.join("; ")}`
  : !config.ARKIV_ACCESS_KEY || !config.ARKIV_SERVER_PRIVATE_KEY
    ? "ARKIV_ACCESS_KEY and ARKIV_SERVER_PRIVATE_KEY must be set in .env"
    : false;

const TEST_LIFETIME = ExpirationTime.fromHours(1);

/**
 * Run a direct SDK call (one that bypasses the service's redacting wrapper). A failure is rethrown
 * as a redacted message, because node:test prints errors in full and viem errors hold the RPC URL.
 */
async function sdk<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new Error(describeArkivError(err, config as Config));
  }
}
const now = () => Math.floor(Date.now() / 1000);

describe("Arkiv live", { skip }, () => {
  let arkiv: ArkivService;
  let serverAddress: `0x${string}`;
  let listingKey: `0x${string}`;

  before(() => {
    arkiv = createArkivService(config as Config);
    serverAddress = arkiv.serverAddress as `0x${string}`;
  });

  it("RPC reports the configured chain", async () => {
    const chainId = await arkiv.checkChain();
    console.log(`  chain id: ${chainId}`);
    assert.equal(chainId, 7794095);
  });

  it("$owner equals the writing address on a real entity (ARCHITECTURE.md 6.1)", async () => {
    const createdAt = now();
    const written = await arkiv.createAgentListing(
      {
        agentId: `live-test-${createdAt}`,
        category: "other",
        data: {
          name: "Live Test Listing",
          description: "Written by test/live/arkiv.live.test.ts. Expires after one hour.",
          skills: ["live test"],
          priceTinybars: "1",
          currency: "HBAR",
          createdAt,
        },
      },
      { expiration: TEST_LIFETIME },
    );
    listingKey = written.entityKey;
    const read = await arkiv.getAgent(written.entityKey);
    assert.equal(read.status, "found");
    if (read.status !== "found") return;
    console.log(`  entityKey: ${written.entityKey}`);
    console.log(`  txHash:    ${written.txHash}`);
    console.log(`  $owner:    ${read.listing.owner}`);
    console.log(`  writer:    ${serverAddress}`);
    assert.equal(read.listing.owner.toLowerCase(), serverAddress.toLowerCase());
    assert.equal(read.listing.creator.toLowerCase(), serverAddress.toLowerCase());
    assert.equal(read.listing.name, "Live Test Listing");
  });

  it("listAgents skips a real malformed entity and reports skippedCount", async () => {
    // Write an entity that fits the AgentListing columns but whose data is not valid JSON.
    const { walletClient } = createArkivClients(config as Config);
    assert.ok(walletClient);
    const malformed = await sdk(() =>
      walletClient.createEntity(
        AgentListing,
        { agentId: `malformed-${now()}`, category: "other", data: new TextEncoder().encode("this is not json") },
        { expiration: TEST_LIFETIME },
      ),
    );
    console.log(`  malformed entityKey: ${malformed.entityKey}`);

    // The testnet is shared and other entities may come and go between scans, so each scan is
    // checked only against the two entities this test wrote, never against totals.
    const checkScan = (label: string, scan: Awaited<ReturnType<ArkivService["listAgents"]>>) => {
      console.log(`  ${label}: ${scan.agents.length} valid, skippedCount ${scan.skippedCount}, truncated ${scan.truncated}`);
      assert.equal(scan.truncated, false, `${label}: the scan must reach the end`);
      assert.equal(new Set(scan.agents.map((a) => a.entityKey)).size, scan.agents.length, `${label}: no listing twice`);
      assert.ok(scan.agents.some((a) => a.entityKey === listingKey), `${label}: this test's valid listing is listed`);
      assert.ok(!scan.agents.some((a) => a.entityKey === malformed.entityKey), `${label}: the malformed entity is not listed`);
      assert.ok(scan.skippedCount >= 1, `${label}: the malformed entity is counted in skippedCount`);
    };

    checkScan("listAgents (default page size)", await arkiv.listAgents());
    // Ten per page, so the $key cursor is used across several real pages.
    checkScan("listAgents (10 per page)", await arkiv.listAgents({ pageSize: 10 }));
    assert.equal((await arkiv.getAgent(malformed.entityKey)).status, "invalid");
  });

  describe("POST /api/agents/verify against the real entity", () => {
    let server: Awaited<ReturnType<typeof startTestServer>>;
    before(async () => {
      server = await startTestServer({ ...(process.env as Record<string, string>), NODE_ENV: "test" }, arkiv);
    });
    after(async () => {
      await server.close();
    });
    const verify = (entityKey: string, address: string) =>
      fetch(`${server.baseUrl}/api/agents/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityKey, address }),
      });

    it("accepts the real owner, in any letter case", async () => {
      const res = await verify(listingKey, serverAddress.toUpperCase().replace("0X", "0x"));
      assert.equal(res.status, 200);
      const body = (await res.json()) as { verified: boolean; listing: { entityKey: string } };
      assert.equal(body.verified, true);
      assert.equal(body.listing.entityKey, listingKey);
    });

    it("rejects an address that does not own the listing", async () => {
      // A second key generated here and never stored or printed; only its address is used.
      const otherAddress = privateKeyToAccount(generatePrivateKey()).address;
      const res = await verify(listingKey, otherAddress);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), {
        error: "This listing is owned by a different address than the one connected.",
        code: "OWNER_MISMATCH",
      });
    });

    it("returns 404 for an entity key that does not exist", async () => {
      const res = await verify("0x" + "0".repeat(63) + "1", serverAddress);
      assert.equal(res.status, 404);
      assert.equal(((await res.json()) as { code: string }).code, "AGENT_NOT_FOUND");
    });
  });

  it("writes a task record, updates its status, and writes an assignment record", async () => {
    const taskId = `live-${now()}`;
    const task = await arkiv.writeTaskRecord(
      { taskId, status: "planning", data: { category: "research", budgetCapTinybars: "20000000", createdAt: now() } },
      { expiration: TEST_LIFETIME },
    );
    console.log(`  task entityKey: ${task.entityKey}  tx ${task.txHash}`);
    const patched = await arkiv.updateTaskStatus(task.entityKey, "completed");
    console.log(`  status patch tx: ${patched.txHash}`);

    // A listing key is refused before any write, so the listing never gains a stray status attribute.
    await assert.rejects(
      arkiv.updateTaskStatus(listingKey, "completed"),
      (err: unknown) => err instanceof AppError && err.code === "NOT_A_TASK_RECORD",
    );
    const listingAfter = await arkiv.getAgent(listingKey);
    assert.equal(listingAfter.status, "found", "the listing is unchanged and still valid");
    console.log("  updateTaskStatus on a listing key: refused (NOT_A_TASK_RECORD)");

    const { publicClient } = createArkivClients(config as Config);
    const row = await sdk(() => publicClient.getEntity(task.entityKey, TaskRecord));
    assert.equal(row.status.value, "completed");
    assert.equal(row.taskId.value, taskId);
    assert.equal(row.$owner.toLowerCase(), serverAddress.toLowerCase());

    const assignment = await arkiv.writeAssignmentRecord(
      {
        taskId,
        agentId: "research",
        status: "done",
        data: { agentEntityKey: listingKey, creatorAddress: serverAddress, amountTinybars: "5000000" },
      },
      { expiration: TEST_LIFETIME },
    );
    console.log(`  assignment entityKey: ${assignment.entityKey}  tx ${assignment.txHash}`);
    assert.match(assignment.entityKey, /^0x[0-9a-f]{64}$/);
  });
});
