/**
 * Create Agent wizard rules. They mirror the server's prepareAgentBodySchema
 * (server/src/schemas/agent.ts), so the form blocks bad input with a clear message before
 * anything is sent. The server validates again; it stays the source of truth.
 */
export const CATEGORIES = [
  { value: "research", label: "Research" },
  { value: "analysis", label: "Analysis" },
  { value: "writing", label: "Writing" },
  { value: "other", label: "Other" },
] as const;

export const MAX_SKILLS = 6;

export interface AgentForm {
  name: string;
  description: string;
  category: string;
  skills: string[];
  price: string;
}

export const EMPTY_FORM: AgentForm = { name: "", description: "", category: "", skills: [], price: "" };

export type StepId = "name" | "description" | "category" | "skills" | "price" | "review";
export const STEPS: { id: StepId; question: string }[] = [
  { id: "name", question: "What is your agent called?" },
  { id: "description", question: "What does it do?" },
  { id: "category", question: "Which category fits best?" },
  { id: "skills", question: "What are its skills?" },
  { id: "price", question: "What should one task cost?" },
  { id: "review", question: "Review and publish" },
];

const MAX_PRICE_HBAR = 1000;

/** The problem with one step's answer, or null when it is fine. */
export function stepError(step: StepId, f: AgentForm): string | null {
  switch (step) {
    case "name": {
      const n = f.name.trim();
      if (n.length < 3) return "The name must be at least 3 characters.";
      if (n.length > 40) return "The name must be at most 40 characters.";
      if (!/[a-z0-9]/i.test(n)) return "The name needs at least one letter or number.";
      return null;
    }
    case "description": {
      const d = f.description.trim();
      if (!d) return "Describe what the agent does.";
      if (d.length > 280) return "The description must be at most 280 characters.";
      return null;
    }
    case "category":
      return CATEGORIES.some((c) => c.value === f.category) ? null : "Choose a category.";
    case "skills": {
      if (f.skills.length > MAX_SKILLS) return `Use at most ${MAX_SKILLS} skills.`;
      if (f.skills.some((s) => !s.trim())) return "Skills cannot be empty.";
      if (f.skills.some((s) => s.trim().length > 24)) return "Each skill must be at most 24 characters.";
      if (new Set(f.skills.map((s) => s.trim().toLowerCase())).size !== f.skills.length) return "Each skill can appear only once.";
      return null;
    }
    case "price": {
      if (!/^\d+(\.\d{1,8})?$/.test(f.price.trim())) return "Enter a price in HBAR, like 0.05 (up to 8 decimals).";
      const v = Number(f.price);
      if (!(v > 0)) return "The price must be more than 0.";
      if (v > MAX_PRICE_HBAR) return "The price must be at most 1000 HBAR.";
      return null;
    }
    case "review":
      return firstError(f);
  }
}

/** The first problem across all steps, so review cannot publish a form that skipped a check. */
export function firstError(f: AgentForm): string | null {
  for (const s of STEPS) {
    if (s.id === "review") continue;
    const e = stepError(s.id, f);
    if (e) return e;
  }
  return null;
}

/** Split typed skills on commas and new lines; keep order, drop blanks. */
export function parseSkills(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
