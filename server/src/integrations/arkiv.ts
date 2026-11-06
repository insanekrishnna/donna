import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  type Expiry,
  NoEntityFoundError,
  SchemaMismatchError,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, eq, gt } from "@arkiv-network/sdk/query";
import { addr, key, SCHEMA_ATTRIBUTE } from "@arkiv-network/sdk/schema";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "../config.js";
import { AppError, redactSecretValues } from "../errors.js";
import {
  type AgentListingInput,
  type AgentListingView,
  agentDataSchema,
  agentIdSchema,
  categorySchema,
  parseAgentRow,
  parseAgentRows,
  type RawAgentRow,
} from "../schemas/agent.js";
import {
  AgentListing,
  AssignmentRecord,
  decodeDataJson,
  encodeDataJson,
  entityKeySchema,
  evmAddressSchema,
  TaskRecord,
} from "../schemas/arkiv.js";
import {
  type AssignmentRecordInput,
  assignmentRecordInputSchema,
  type TaskRecordInput,
  taskRecordInputSchema,
  type TaskStatus,
  TASK_STATUSES,
} from "../schemas/task.js";

/** Default lifetimes (ARCHITECTURE.md section 4.1). */
export const LISTING_LIFETIME = ExpirationTime.fromDays(30);
export const RECORD_LIFETIME = ExpirationTime.fromDays(7);

/** The SDK's MAX_LIMIT: one query returns at most 100 rows. */
const MAX_QUERY_LIMIT = 100;

/**
 * listAgents page size. Kept small because anyone can write donna-agent entities with a large
 * `data` value (up to 128 KiB each), and one oversized page could exceed the RPC response limit.
 */
const LIST_PAGE_SIZE = 25;

/** listAgents reads at most this many entities per scan, then reports `truncated`. */
const LIST_MAX_ENTITIES = 1000;

/**
 * The schema's tag (a typed str value holding "donna-agent"), which the SDK writes into the indexed
 * `arkiv.schema` attribute. We filter on it exactly as the SDK's own `from(schema)` does
 * (`eq(SCHEMA_ATTRIBUTE, schema.tag)` in src/query/builderBase.ts).
 */
const AGENT_LISTING_TAG = (() => {
  const tag = AgentListing.tag;
  if (tag === undefined) throw new Error("AgentListing schema must be named");
  return tag;
})();

export interface WriteResult {
  entityKey: Hex;
  txHash: Hex;
  /** Block number at which the entity expires. */
  expiresAt: bigint;
}

export type GetAgentResult =
  | { status: "found"; listing: AgentListingView }
  | { status: "not_found" }
  | { status: "invalid" };

export interface ArkivService {
  /** Public address of the server key, or undefined when ARKIV_SERVER_PRIVATE_KEY is not set. */
  readonly serverAddress: Hex | undefined;
  /** Throws unless the RPC reports ARKIV_CHAIN_ID. */
  checkChain(): Promise<number>;
  /** Server-key write of a listing. Used by the seed and smoke scripts only. */
  createAgentListing(input: AgentListingInput, options?: { expiration?: Expiry }): Promise<WriteResult>;
  /**
   * All valid listings. Entities that fail validation are skipped and counted.
   * `truncated` is true when more entities exist than one scan reads.
   */
  listAgents(options?: { pageSize?: number }): Promise<{ agents: AgentListingView[]; skippedCount: number; truncated: boolean }>;
  getAgent(entityKey: string): Promise<GetAgentResult>;
  /** Valid listing with this agentId owned by `owner`, if one exists. */
  findAgent(agentId: string, owner: Hex): Promise<AgentListingView | undefined>;
  writeTaskRecord(input: TaskRecordInput, options?: { expiration?: Expiry }): Promise<WriteResult>;
  updateTaskStatus(entityKey: string, status: TaskStatus): Promise<{ txHash: Hex }>;
  writeAssignmentRecord(input: AssignmentRecordInput, options?: { expiration?: Expiry }): Promise<WriteResult>;
}

/** Replace every Arkiv secret in a message, so Arkiv errors (which include the RPC URL) are safe to log. */
export function redactSecrets(message: string, config: Pick<Config, "ARKIV_ACCESS_KEY" | "ARKIV_SERVER_PRIVATE_KEY">): string {
  return redactSecretValues(message, [config.ARKIV_ACCESS_KEY, config.ARKIV_SERVER_PRIVATE_KEY]);
}

/** Short, redacted description of an SDK or viem error, for server logs and scripts. */
export function describeArkivError(err: unknown, config: Pick<Config, "ARKIV_ACCESS_KEY" | "ARKIV_SERVER_PRIVATE_KEY">): string {
  if (!(err instanceof Error)) return "non-Error value thrown";
  const e = err as Error & { shortMessage?: string; details?: string };
  const parts = [`${e.name}: ${e.shortMessage ?? e.message}`];
  if (e.details && e.details !== e.shortMessage) parts.push(`(${e.details})`);
  return redactSecrets(parts.join(" "), config);
}

export function createArkivClients(config: Config) {
  if (!config.ARKIV_ACCESS_KEY) {
    throw new AppError(503, "ARKIV_NOT_CONFIGURED", "Arkiv is not configured on the server.");
  }
  const chain = rabdi({ accessKey: config.ARKIV_ACCESS_KEY });
  const publicClient = createPublicClient({ chain, transport: http() });
  let account: ReturnType<typeof privateKeyToAccount> | undefined;
  if (config.ARKIV_SERVER_PRIVATE_KEY) {
    try {
      account = privateKeyToAccount(config.ARKIV_SERVER_PRIVATE_KEY as Hex);
    } catch {
      // viem's message includes the key as a number, so never pass it on.
      throw new AppError(500, "ARKIV_KEY_INVALID", "ARKIV_SERVER_PRIVATE_KEY is not a valid secp256k1 private key.");
    }
  }
  const walletClient = account ? createWalletClient({ chain, transport: http(), account }) : undefined;
  return { chain, publicClient, walletClient, account };
}

export function createArkivService(config: Config): ArkivService {
  const { publicClient, walletClient, account } = createArkivClients(config);

  /** Run an Arkiv call. Unknown failures are logged (redacted) and become a plain 502. */
  async function call<T>(action: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error(`Arkiv ${action} failed: ${describeArkivError(err, config)}`);
      throw new AppError(502, "ARKIV_UNAVAILABLE", `Could not ${action} on Arkiv. Please try again in a moment.`);
    }
  }

  function requireWallet() {
    if (!walletClient) {
      throw new AppError(503, "ARKIV_WRITE_NOT_CONFIGURED", "The server's Arkiv key is not configured, so it cannot write.");
    }
    return walletClient;
  }

  /**
   * Read our three columns from an untyped row. A column that is missing or has another type
   * becomes empty or undefined, so the row then fails Zod and is skipped.
   */
  function rawRowFromUntyped(row: {
    $key: Hex;
    $owner: Hex;
    $creator: Hex;
    $expiresAt: bigint;
    agentId: { type: string; value: unknown } | undefined;
    category: { type: string; value: unknown } | undefined;
    data: { type: string; value: unknown } | undefined;
  }): RawAgentRow {
    const typed = (value: { type: string; value: unknown } | undefined, type: string): unknown =>
      value && value.type === type ? value.value : undefined;
    const data = typed(row.data, "bytes");
    const agentId = typed(row.agentId, "str");
    const category = typed(row.category, "str");
    return {
      entityKey: row.$key,
      owner: row.$owner,
      creator: row.$creator,
      expiresAt: row.$expiresAt,
      agentId: typeof agentId === "string" ? agentId : "",
      category: typeof category === "string" ? category : "",
      data: typeof data === "string" ? decodeDataJson(data) : undefined,
    };
  }

  function toRawAgentRow(row: {
    $key: Hex;
    $owner: Hex;
    $creator: Hex;
    $expiresAt: bigint;
    agentId: { value: string };
    category: { value: string };
    data: { value: Hex };
  }): RawAgentRow {
    return {
      entityKey: row.$key,
      owner: row.$owner,
      creator: row.$creator,
      expiresAt: row.$expiresAt,
      agentId: row.agentId.value,
      category: row.category.value,
      data: decodeDataJson(row.data.value),
    };
  }

  return {
    serverAddress: account?.address,

    async checkChain() {
      const chainId = await call("read the chain ID", () => publicClient.getChainId());
      if (chainId !== config.ARKIV_CHAIN_ID) {
        throw new AppError(
          500,
          "ARKIV_WRONG_CHAIN",
          `Arkiv RPC reports chain ${chainId}, but ARKIV_CHAIN_ID is ${config.ARKIV_CHAIN_ID}.`,
        );
      }
      return chainId;
    },

    async createAgentListing(input, options) {
      const wallet = requireWallet();
      // Validate everything before any write: str columns are capped at 128 bytes, data by Zod.
      const agentId = agentIdSchema.parse(input.agentId);
      const category = categorySchema.parse(input.category);
      const data = encodeDataJson(agentDataSchema.parse(input.data));
      return call("write the agent listing", () =>
        wallet.createEntity(AgentListing, { agentId, category, data }, { expiration: options?.expiration ?? LISTING_LIFETIME }),
      );
    },

    async listAgents(options) {
      // pageSize is for tests; it is clamped to 1..100.
      const pageSize = Math.min(MAX_QUERY_LIMIT, Math.max(1, Math.floor(options?.pageSize ?? LIST_PAGE_SIZE)));
      const maxPages = Math.ceil(LIST_MAX_ENTITIES / pageSize);
      // Page by key, not offset: offsets shift when entities expire or are created mid-scan.
      // The query filters on the schema tag without going through the schema, so the SDK skips
      // nothing and every page has a last $key to continue from. We validate every row ourselves.
      // We select only our three columns by name (not $attributes), so extra attributes on junk
      // entities never enter the response.
      const agents: AgentListingView[] = [];
      const seen = new Set<string>();
      let skippedCount = 0;
      let lastKey: Hex | undefined;
      let truncated = false;
      for (let page = 0; ; page += 1) {
        if (page === maxPages) {
          // We stop only on an empty page, so reaching the cap means more entities may exist.
          truncated = true;
          break;
        }
        const cursor = lastKey;
        const result = await call("read agent listings", () =>
          publicClient
            .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, agentId: true, category: true, data: true })
            .where(
              cursor
                ? and(eq(SCHEMA_ATTRIBUTE, AGENT_LISTING_TAG), gt("$key", key(cursor)))
                : eq(SCHEMA_ATTRIBUTE, AGENT_LISTING_TAG),
            )
            .orderBy(asc("$key"))
            .limit(pageSize)
            .fetch(),
        );
        for (const row of result.entities) {
          if (seen.has(row.$key)) continue;
          seen.add(row.$key);
          const listing = parseAgentRow(rawRowFromUntyped(row));
          if (listing) agents.push(listing);
          else skippedCount += 1;
        }
        // Stop only on an empty page. A short page is not proof of the end: a node may return
        // fewer rows than the limit (for example, to stay under a response size cap).
        const last = result.entities.at(-1);
        if (!last) break;
        lastKey = last.$key;
      }
      return { agents, skippedCount, truncated };
    },

    async getAgent(entityKey) {
      const key = entityKeySchema.parse(entityKey) as Hex;
      try {
        const row = await publicClient.getEntity(key, AgentListing);
        const listing = parseAgentRow(toRawAgentRow(row));
        return listing ? { status: "found", listing } : { status: "invalid" };
      } catch (err) {
        if (err instanceof NoEntityFoundError) return { status: "not_found" };
        if (err instanceof SchemaMismatchError) return { status: "invalid" };
        console.error(`Arkiv read the agent listing failed: ${describeArkivError(err, config)}`);
        throw new AppError(502, "ARKIV_UNAVAILABLE", "Could not read the agent listing on Arkiv. Please try again in a moment.");
      }
    },

    async findAgent(agentId, owner) {
      const id = agentIdSchema.parse(agentId);
      const ownerAddress = evmAddressSchema.parse(owner) as Hex;
      const result = await call("look up an agent listing", () =>
        publicClient
          .select({ $key: true, $owner: true, $creator: true, $expiresAt: true, agentId: true, category: true, data: true })
          .from(AgentListing)
          .where(eq("agentId", id))
          .ownedBy(ownerAddress)
          .limit(MAX_QUERY_LIMIT)
          .fetch(),
      );
      return parseAgentRows(result.entities.map(toRawAgentRow)).agents[0];
    },

    async writeTaskRecord(input, options) {
      const wallet = requireWallet();
      const valid = taskRecordInputSchema.parse(input);
      const data = encodeDataJson(valid.data);
      return call("write the task record", () =>
        wallet.createEntity(
          TaskRecord,
          {
            taskId: valid.taskId,
            status: valid.status,
            ...(valid.requesterAddress ? { requesterAddress: addr(valid.requesterAddress as Hex) } : {}),
            data,
          },
          { expiration: options?.expiration ?? RECORD_LIFETIME },
        ),
      );
    },

    async updateTaskStatus(entityKey, status) {
      const wallet = requireWallet();
      const key = entityKeySchema.parse(entityKey) as Hex;
      if (!TASK_STATUSES.includes(status)) throw new AppError(400, "INVALID_INPUT", "Unknown task status.");
      // Patch only real donna-task entities. Without this check, a listing key would gain a
      // stray `status` attribute, because patchEntity writes whatever columns it is given.
      try {
        await publicClient.getEntity(key, TaskRecord);
      } catch (err) {
        if (err instanceof NoEntityFoundError) {
          throw new AppError(404, "TASK_NOT_FOUND", "No live task record has this entity key.");
        }
        if (err instanceof SchemaMismatchError) {
          throw new AppError(400, "NOT_A_TASK_RECORD", "This entity key is not a Donna task record.");
        }
        console.error(`Arkiv read the task record failed: ${describeArkivError(err, config)}`);
        throw new AppError(502, "ARKIV_UNAVAILABLE", "Could not read the task record on Arkiv. Please try again in a moment.");
      }
      return call("update the task status", () => wallet.patchEntity(TaskRecord, key, { set: { status } }));
    },

    async writeAssignmentRecord(input, options) {
      const wallet = requireWallet();
      const valid = assignmentRecordInputSchema.parse(input);
      const data = encodeDataJson(valid.data);
      return call("write the assignment record", () =>
        wallet.createEntity(
          AssignmentRecord,
          { taskId: valid.taskId, agentId: valid.agentId, status: valid.status, data },
          { expiration: options?.expiration ?? RECORD_LIFETIME },
        ),
      );
    },
  };
}
