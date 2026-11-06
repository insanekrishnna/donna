import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import type { EIP1193Provider, Hex } from "viem";
import { ProofBadge } from "../components/ProofBadge";
import { useWallet } from "../components/WalletButton";
import { ErrorBanner, PageTitle } from "../components/ui";
import { type AgentForm, CATEGORIES, EMPTY_FORM, MAX_SKILLS, parseSkills, STEPS, stepError } from "../lib/agentForm";
import { type Agent, ApiError, api } from "../lib/api";
import { describePublishError, publishListing } from "../lib/arkivWallet";
import { ARKIV_EXPLORER } from "../lib/wagmi";

type Phase = "form" | "preparing" | "signing" | "verifying";

export function CreateAgent() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AgentForm>(EMPTY_FORM);
  const [skillsText, setSkillsText] = useState("");
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("form");
  const [published, setPublished] = useState<{ listing: Agent; txHash: Hex } | null>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const step = STEPS[index] ?? STEPS[0]!;

  useEffect(() => {
    fieldRef.current?.focus();
  }, [index]);

  const update = (patch: Partial<AgentForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    const problem = stepError(step.id, form);
    if (problem) {
      setError(problem);
      return;
    }
    if (step.id === "review") void publish();
    else setIndex((i) => i + 1);
  };

  async function publish() {
    if (!wallet.isConnected || !wallet.address || !wallet.connector) {
      setError("Connect your wallet first. The listing is published from your address.");
      return;
    }
    if (!wallet.onArkiv) {
      setError("Switch your wallet to the Arkiv network first (button at the top).");
      return;
    }
    setError(null);
    try {
      setPhase("preparing");
      const { listing } = await api.prepareAgent({
        name: form.name.trim(),
        description: form.description.trim(),
        category: form.category,
        skills: form.skills.map((s) => s.trim()),
        pricePerTask: form.price.trim(),
      });
      setPhase("signing");
      const provider = (await wallet.connector.getProvider()) as EIP1193Provider;
      let result;
      try {
        result = await publishListing(provider, wallet.address, listing);
      } catch (err) {
        setError(describePublishError(err));
        setPhase("form");
        return;
      }
      setPhase("verifying");
      const verified = await api.verifyAgent(result.entityKey, wallet.address);
      setPublished({ listing: verified.listing, txHash: result.txHash });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
    setPhase("form");
  }

  if (published) {
    const { listing, txHash } = published;
    return (
      <div className="mx-auto max-w-xl">
        <div className="card space-y-4">
          <div className="flex items-center gap-2 text-donna-success">
            <CheckCircle2 size={20} aria-hidden />
            <h1 className="text-lg font-semibold">{listing.name} is published on Arkiv</h1>
          </div>
          <p className="text-sm text-donna-muted">
            Your wallet signed the listing, so your address is its owner and creator. It stays listed for 30 days.
          </p>
          <div className="flex flex-col items-start gap-2">
            <ProofBadge label="Creator" value={listing.owner} />
            <ProofBadge label="Arkiv entity" value={listing.entityKey} href={`${ARKIV_EXPLORER}/entity/${listing.entityKey}`} />
            <ProofBadge label="Arkiv tx" value={txHash} href={`${ARKIV_EXPLORER}/tx/${txHash}`} />
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <a href="#/marketplace" className="btn-primary">
              View in marketplace
            </a>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPublished(null);
                setForm(EMPTY_FORM);
                setSkillsText("");
                setIndex(0);
              }}
            >
              Create another
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busy = phase !== "form";
  const busyText: Record<Phase, string> = {
    form: "",
    preparing: "Checking your details...",
    signing: "Confirm the transaction in your wallet...",
    verifying: "Reading it back from Arkiv...",
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="Create an agent" subtitle="Publish a listing to Arkiv from your own wallet." />
      {!wallet.isConnected && (
        <div className="mb-6">
          <ErrorBanner message="Connect your wallet to publish. You can fill in the form first." />
        </div>
      )}
      {wallet.isConnected && !wallet.onArkiv && (
        <div className="mb-6">
          <ErrorBanner message="Your wallet is on another network. Use “Switch to Arkiv” at the top before publishing." />
        </div>
      )}

      <form className="card space-y-6" onSubmit={next} noValidate>
        <div>
          <div className="mb-2 flex justify-between text-xs text-donna-muted">
            <span>
              Step {index + 1} of {STEPS.length}
            </span>
            {index > 0 && !busy && (
              <button type="button" className="underline" onClick={() => setIndex((i) => i - 1)}>
                Back
              </button>
            )}
          </div>
          <div className="h-1 rounded-full bg-donna-line" aria-hidden>
            <div className="h-1 rounded-full bg-donna-accent" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>

        <fieldset className="space-y-3" disabled={busy}>
          <legend className="mb-3 text-lg font-semibold">{step.question}</legend>

          {step.id === "name" && (
            <>
              <input ref={fieldRef} className="input" aria-label="Agent name" placeholder="Market Scout" value={form.name} maxLength={60} onChange={(e) => update({ name: e.target.value })} />
              <p className="text-xs text-donna-muted">3 to 40 characters.</p>
            </>
          )}
          {step.id === "description" && (
            <>
              <textarea ref={fieldRef} className="input min-h-28" aria-label="What the agent does" placeholder="Finds recent pricing for SaaS tools and summarizes it." value={form.description} onChange={(e) => update({ description: e.target.value })} />
              <p className="text-xs text-donna-muted">{form.description.trim().length} / 280</p>
            </>
          )}
          {step.id === "category" && (
            <div role="radiogroup" aria-label="Category" className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((c, i) => (
                <label key={c.value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${form.category === c.value ? "border-donna-accent bg-donna-accent-soft" : "border-donna-line"}`}>
                  <input ref={i === 0 ? fieldRef : undefined} type="radio" name="category" value={c.value} checked={form.category === c.value} onChange={() => update({ category: c.value })} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
          {step.id === "skills" && (
            <>
              <input
                ref={fieldRef}
                className="input"
                aria-label="Skills, separated by commas"
                placeholder="pricing, summaries, market data"
                value={skillsText}
                onChange={(e) => {
                  setSkillsText(e.target.value);
                  update({ skills: parseSkills(e.target.value) });
                }}
              />
              <p className={`text-xs ${form.skills.length > MAX_SKILLS ? "text-donna-danger" : "text-donna-muted"}`}>
                Separate with commas. {form.skills.length} / {MAX_SKILLS} skills, each up to 24 characters. Optional.
              </p>
            </>
          )}
          {step.id === "price" && (
            <>
              <div className="flex items-center gap-2">
                <input ref={fieldRef} className="input" inputMode="decimal" aria-label="Price per task in HBAR" placeholder="0.05" value={form.price} onChange={(e) => update({ price: e.target.value })} />
                <span className="text-sm text-donna-muted">HBAR</span>
              </div>
              <p className="text-xs text-donna-muted">Testnet HBAR. Shown to people who hire your agent.</p>
            </>
          )}
          {step.id === "review" && (
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-donna-muted">Name</dt>
              <dd>{form.name.trim()}</dd>
              <dt className="text-donna-muted">Does</dt>
              <dd>{form.description.trim()}</dd>
              <dt className="text-donna-muted">Category</dt>
              <dd>{CATEGORIES.find((c) => c.value === form.category)?.label}</dd>
              <dt className="text-donna-muted">Skills</dt>
              <dd>{form.skills.length ? form.skills.join(", ") : "None"}</dd>
              <dt className="text-donna-muted">Price</dt>
              <dd>{form.price.trim()} HBAR per task</dd>
              <dt className="text-donna-muted">Creator</dt>
              <dd className="break-all font-mono text-xs">{wallet.address ?? "Connect your wallet"}</dd>
            </dl>
          )}
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-donna-danger">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="text-sm text-donna-warn">
            {busyText[phase]}
          </p>
        )}

        <button type="submit" className="btn-primary w-full" disabled={busy || (step.id === "review" && (!wallet.isConnected || !wallet.onArkiv))}>
          {step.id === "review" ? (busy ? "Publishing..." : "Publish agent") : "Continue"}
        </button>
      </form>
    </div>
  );
}
