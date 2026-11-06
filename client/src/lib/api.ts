/**
 * Typed calls to the Donna API. Every error becomes an ApiError with a plain-language message
 * (the server already sends one; network failures get our own).
 */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Cannot reach the Donna server. Check that it is running and try again.", "NETWORK", 0);
  }
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body ?? {}) as { error?: string; code?: string };
    throw new ApiError(err.error ?? `The server answered with HTTP ${res.status}.`, err.code ?? "HTTP_ERROR", res.status);
  }
  return body as T;
}

// ---- types (mirror the server responses) ----

export interface Agent {
  entityKey: string;
  owner: string;
  creator: string;
  expiresAtBlock: string;
  agentId: string;
  category: "research" | "analysis" | "writing" | "other";
  name: string;
  description: string;
  skills: string[];
  priceTinybars: string;
  priceHbar: string;
  currency: "HBAR";
  serviceUrl?: string;
  createdAt: number;
}

export interface AgentsResponse {
  agents: Agent[];
  skippedCount: number;
  truncated: boolean;
  platformAddress: string | null;
}

export interface PreparedListing {
  agentId: string;
  category: string;
  data: Record<string, unknown>;
}

export interface Receipt {
  id: string;
  taskId: string;
  payerAgentId: string;
  payeeAgentId: string;
  amountTinybars: string;
  amountHbar: string;
  hederaTxId?: string;
  hashScanUrl?: string;
  status: "settled" | "failed";
  createdAt: number;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface TaskView {
  id: string;
  status: "planning" | "running" | "completed" | "failed";
  error: string | null;
  task: string;
  agentIds: string[];
  createdAt: number;
  updatedAt: number;
  budget: { capHbar: string | null; estimatedCostHbar: string | null; spentHbar: string | null; remainingHbar: string | null };
  steps: {
    id: string;
    agentId: string;
    instruction: string;
    dependsOn: string[];
    needsPaidData: boolean;
    status: StepStatus;
    output: string | null;
    llmRequestId: string | null;
    error: string | null;
  }[];
  report: string | null;
  receipts: Receipt[];
  proof: {
    planRequestId: string | null;
    llmCalls: { step: string; agentId: string; status: StepStatus; llmRequestId: string | null }[];
    arkiv: {
      taskEntityKey?: string;
      taskTxHash?: string;
      statusTxHashes: { status: string; txHash: string }[];
      assignments: { agentId: string; stepId: string; status: string; entityKey: string; txHash: string }[];
    };
  };
}

export const api = {
  health: () => request<{ status: string; missing: string[] }>("/api/health"),
  agents: () => request<AgentsResponse>("/api/agents"),
  prepareAgent: (body: { name: string; description: string; category: string; skills: string[]; pricePerTask: string }) =>
    request<{ listing: PreparedListing }>("/api/agents/prepare", { method: "POST", body: JSON.stringify(body) }),
  verifyAgent: (entityKey: string, address: string) =>
    request<{ verified: true; listing: Agent }>("/api/agents/verify", {
      method: "POST",
      body: JSON.stringify({ entityKey, address }),
    }),
  startTask: (body: { task: string; budgetHbar: string; agentIds: string[]; requesterAddress?: string }) =>
    request<{ taskId: string; status: string }>("/api/tasks", { method: "POST", body: JSON.stringify(body) }),
  task: (id: string) => request<TaskView>(`/api/tasks/${encodeURIComponent(id)}`),
  payments: () => request<{ receipts: Receipt[] }>("/api/payments"),
};
