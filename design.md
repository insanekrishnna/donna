# design.md: Donna








This file defines how Donna looks and feels. Follow it for every screen. Do not invent new colors, fonts, or spacing values outside this file.

## Design direction
Donna should feel calm, clear, and trustworthy. Users are handing money and tasks to AI agents, so the interface should look organized and honest, not flashy.







Keywords: clean, editorial, legible, precise, quietly confident.






Avoid:
- Purple-to-blue gradients and neon crypto aesthetics.
- Glassmorphism blobs and decorative 3D orbs.
- Stock "AI sparkle" icons everywhere.
- Walls of animation. Motion is for feedback only.
- Corporate jargon in UI copy.






## Colors (Tailwind tokens)
Define these in tailwind.config as the `donna` palette.

| Token | Hex | Use |
|---|---|---|
| donna-bg | #F7F5F0 | Page background (warm off-white) |
| donna-surface | #FFFFFF | Cards, panels |
| donna-ink | #14130F | Primary text |
| donna-muted | #6B6860 | Secondary text, labels |
| donna-line | #E4E0D6 | Borders, dividers |
| donna-accent | #1F6F5C | Primary buttons, selected states (deep teal) |
| donna-accent-soft | #DCEEE8 | Accent backgrounds, badges |
| donna-warn | #B7791F | Budget near limit, pending states |
| donna-danger | #B42318 | Errors, failed payments |
| donna-success | #1F7A3A | Confirmed payments, completed tasks |

Dark mode is optional. Do not build it in the MVP.

## Typography
- Headings: "Inter" or "Geist" (pick one, use it everywhere). Weight 600 for headings, 500 for labels.
- Body: same family, weight 400, 16px base, line-height 1.6.
- Monospace for IDs, addresses, and hashes: "JetBrains Mono" or "ui-monospace".
- Scale: 12, 14, 16, 20, 28, 40. Do not use other sizes.

Load fonts from Google Fonts only. Provide system fallbacks.

## Spacing and layout
- Use Tailwind's default 4px scale. Common values: 2, 3, 4, 6, 8, 12, 16.
- Max content width: 1120px. Centered.
- Cards: rounded-xl, 1px border donna-line, padding 6 (24px). No heavy shadows: use shadow-sm at most.
- Buttons: rounded-lg, height 40px, font-medium.
- Mobile first. Every screen must work at 375px width.

## Core components
Build these once and reuse them.

1. AppShell: top bar with logo, nav (Marketplace, Create Agent, Tasks, Payments), and wallet button.
2. WalletButton: shows "Connect wallet" or a shortened address (0x12ab...9f3e) with a copy button. Shows the network name.
3. AgentCard: name, category badge, one-line description, price per task, creator address (monospace, shortened, copy button), skills as small chips, and a primary action button "Add to team" or "Remove from team".
4. TeamTray: fixed bottom bar showing selected agents, total estimated cost, and "Start task" button. Hidden when no agents are selected.
5. TaskComposer: large textarea, budget input (labeled in HBAR), "Start task" button.
6. ProgressTimeline: vertical list of steps (Plan, Discover, Assign, Pay, Execute, Combine). Each step has a state: pending, running, done, failed.
7. ReceiptRow: agent name, amount, status, and a link to HashScan. Monospace transaction ID.
8. ProofBadge: small badge showing "0G request ID", "Arkiv entity", or "Hedera tx" with the real ID and a link.
9. EmptyState: short line, one action.
10. ErrorBanner: plain-language message plus "Try again". Never show raw stack traces.

## Screens
1. Home: headline, one-sentence explanation, two buttons ("Explore agents", "Create an agent"), three-step explainer.
2. Marketplace: search input, category filter chips, grid of AgentCards, TeamTray at bottom.
3. Create Agent: conversational wizard, one question per step, with a progress indicator. Steps: name, what it does, category, skills, price per task, review and publish.
4. Publish confirmation: shows the connected creator address, the Arkiv entity key, and a "View in marketplace" button.
5. New Task: TaskComposer with the selected team listed above it.
6. Task Run: ProgressTimeline, live log of agent messages, ProofBadges as they become real.
7. Result: final report (readable Markdown rendering), agents used, receipts, total spent, and "Run again" button.
8. Payments: table of ReceiptRows across all tasks.

## UI copy rules
- Short sentences. Plain English. No "leverage", "revolutionize", "seamless", "cutting-edge", "unlock".
- Say what happens: "Hiring Research Agent for $0.05" not "Initiating agent engagement protocol".
- Buttons are verbs: "Publish agent", "Start task", "Copy address".
- Errors say what to do next.
- Use real numbers. Never show "Coming soon" on a button that looks active.

## Motion
- Only subtle transitions: 150ms ease-out on hover and focus.
- Progress timeline may pulse the "running" dot. Nothing else.
- Respect prefers-reduced-motion.

## States every screen must handle
- Loading (skeleton or spinner with text)
- Empty
- Error
- Wallet not connected
- Wrong network
- Success

## Accessibility
- Color contrast at least WCAG AA for text.
- Every icon-only button has an aria-label.
- Full keyboard navigation for the marketplace and wizard.
- Visible focus ring: 2px donna-accent outline.

## Demo polish (last phase only)
- One clean logo: wordmark "donna" in Inter 600 with a small teal dot.
- Favicon: teal dot on off-white.
- No illustrations required.
