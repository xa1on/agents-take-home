# Origin AI Engineering Take-Home: Referral Inbox Triage Agent

Origin builds software for pediatric therapy practices. In this assignment, you are helping a fictional practice, Cedar Kids Therapy, triage its Monday inbox.

## Scenario

It is Monday at 8am at a multi-disciplinary pediatric therapy practice supporting speech-language pathology, occupational therapy, and physical therapy. The shared inbox accumulated items over the weekend from pediatrician fax referrals, parent voicemails, parent portal messages, and emails. Build an AI agent prototype that turns the messy batch into a sorted, human-reviewable action plan.

## What We Expect

Strong submissions are usually incomplete but honest. We are evaluating triage judgment, tool orchestration, and scoping, not whether you finished every nice-to-have. Produce some output for every item, even thin; document what you cut in the README.

You may use any AI coding agent (Claude Code, Cursor, Codex, etc.) while building. State your stack and assumptions in your README.

Runtime LLM usage is allowed and recommended, but not required. Origin will provide a temporary capped API key for either OpenAI or Anthropic; the email distributing the key will name the provider and the environment variable to set (`OPENAI_API_KEY` or `ANTHROPIC_API_KEY`). You may also use your own provider. You may install dependencies for the provider you choose (e.g., `npm install openai` or `npm install @anthropic-ai/sdk`). Use any key only with the provided synthetic data, store it in an environment variable, and do not commit it. Model choice is not part of the rubric.

## How To Run

```bash
npm install
npm run triage   -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
npm run validate -- --input data/inbox.json --output output.json --trace .trace/tool-calls.jsonl
```

The commands also work with no flags and default to the paths above. Reviewers may run the same commands against similar hidden synthetic input. Do not hardcode input, output, or trace paths.

## Share And Submit

Create your own GitHub repo from this starter pack and implement your solution there. The repo can be public or private. When you are done, submit the repo link. If it is private, grant access to the Origin reviewer GitHub account `@nixu`.

Commit your code, your updated `README.md`, and your final generated `output.json`. Do not commit API keys, `.env` files, real PHI, `node_modules/`, or `.trace/`.

We expect you to spend about 2 hours. If you stop before finishing, commit what you have and describe the cuts in your README.

### Submission Details

### 1. How to Run (basically the same as above)

```bash
# Install dependencies
npm install

# Run the triage pipeline
npm run triage

# Run the validation suite
npm run validate

# Run the safety & production evaluation suite
npm run evaluate

# Run TypeScript compilation
npm run typecheck
```

The triage pipeline outputs the structured results to `output.json` and trace details to `.trace/tool-calls.jsonl`.

### 2. Stack and Runtime
- **Runtime**: Node.js (LTS), utilizing standard ECMAScript modules (`type: "module"`).
- **Languages & Compiler**: TypeScript 5.7+ with `tsx` (TypeScript Execute).
- **AI / LLM Layer**: Anthropic Claude (`@anthropic-ai/sdk`) utilizing Claude 3.5 Sonnet (improved coordination, decision-making, and self-auditing).
- **Environment**: Managed using `dotenv` (`ANTHROPIC_API_KEY`).

### 3. Architecture
The agent is designed as a pure tool-calling architecture built directly on claude:
1. **Tool-Use Loop**: Initially attempted a hybrid heuristic approach, but ultimately landed on an advanced tool-calling architecture to avoid hardcoded heuristic fallbacks in favor of an agent loop. For each weekend inbox item, claude evaluates the context, dynamically requests tool calls (such as database patient lookup, insurance verification, policy retrieval, slot searching, task routing, or message drafting), and adjusts its plan based on tool outputs in real-time.
2. **Policy-Compliant Task & Escalation Routing**:
   - **Safeguarding (P0)**: Implements escalation via the `escalate` tool, triggers a high-urgency internal task for the `clinical_lead`, and enforces strict communication safeguards (see section 4).
   - **Same-Day Cancellations (P1)**: Escalates same-day drops, searches therapist availability, and holds a slot when matching the parent's explicit timing preferences, creating a `front_desk` follow-up task.
   - **Future Reschedules (P2)**: Calibrates planned reschedules (e.g. cancelling next week's session) as P2 standard scheduling tasks routed to `intake`.
   - **Out-of-Network Coordination**: Halts slot holds and assigns priority billing reviews to `billing` for Out-of-Network or expired benefits.
   - **Language Access**: Employs bilingual scheduling and translates replies.
3. **Structured Outputs via Tool Calls**: Created a "fake" tool called `submit_triage_result` that Claude 3.5 Sonnet calls at the end of its reasoning loop to submit the triage result to the runtime. This tool call is intercepted by the runtime and used to generate the final output.json and trace.json files. This ensures that the output is always in the correct format and that the trace is always generated. This is also better than utilziing the standard Anthropic `output` parameter because it allows us to control the output schema and the trace is always generated.

### 4. Advanced Production Safety Guardrails & Firewalls
To ensure reliability, compliance, and safety, there are several programmatic and cognitive layers:
- **Guardrail Auditor & Self-Correction**: Inside the `submit_triage_result` tool call interception, the runtime launches an independent compliance auditor prompt using claude. This secondary model scans the drafted response for clinical advice, predictions, or treatment suggestions. If a safety violation is detected, it returns a structured critique, prompting claude to self-correct and rewrite the message.
- **Spanish Language Access Auditor**: The auditor is enriched to automatically scan the family's language preferences. If a Spanish preference is detected, the auditor asserts that the drafted response is written fully in Spanish; any language mismatch triggers a self-correction rewrite loop.
- **Safeguarding (P0) Digital Silence**: To protect children and families in safeguarding scenarios (suspected abuse, domestic neglect), the runtime deterministically overrides and clears the draft (`draft_reply = null`) for any P0 safeguarding items. This guarantees zero outbound digital paper trails that could be intercepted by an abuser, forcing immediate secure phone outreach by the clinic lead.
- **OON Slot Hold Programmatic Firewall**: Programmatically firewalls any `hold_slot` attempts at the TypeScript runtime level if the verification status returns `out_of_network` or `expired`, prompting claude to explain the billing policy and request benefits coordination first.
- **Anthropic Prompt Caching**: Implements static cache control breakpoints inside the `toolDefinitions` array (on the final tool) and the `systemPrompt` text blocks. Because the inbox items are processed sequentially, hopefully slashing prompt token costs and cutting execution latency.

### 5. Failure Modes and Production Eval
*   **Resiliency to Outages and Backend Failures**: The Anthropic SDK is explicitly configured to handle LLM rate-limiting and timeouts with exponential backoffs (`maxRetries: 3`). In a real production environment, every network-bound tool call (e.g. querying EHR databases like Epic/Athena, or insurance clearinghouses like Availity) would also be wrapped in retry blocks with exponential backoff and jitter to prevent transient tool errors from halting the agent. In this prototype, toolcalls are synchronous local stubs, so they execute without failures.
*   **Executable Compliance & Safety Suite (`src/evaluate_failures.ts`)**: To validate safety guardrails, there is an evaluation suite run via `npm run evaluate`. This suite directly asserts compliance against our golden triage outputs to verify P0 safeguarding digital silence (forcing `draft_reply = null` for abuse cases), the out-of-network slot hold firewall, same-day cancellation escalations, bilingual Spanish translation preference matches, and strict redirection of clinical advice questions.

### 6. What I Chose Not to Build, and Why
- **Heuristic-Only Fallback**: Refused to use simple rule-based parsers for the primary loop. Heuristics are extremely brittle for clinic-grade triage, and relying on Claude's multi-step cognitive reasoning guarantees correct policy orchestration for unstructured clinical text.
- **Auto-Committing Schedules**: Avoided booking appointments automatically. The agent draft the message and hold slots temporarily to ensure clinical coordinators retain control.

### 7. What I Would Do with Another 4 Hours
- **Vector Database Integrations**: Implement semantic embedding lookup to match incoming referral diagnosis terms with therapist specialties in `providers.json`.
- **Interactive Intake Dashboard**: Build a Vite-based react dashboard for front-desk staff to visualize the agent's triage logs, edit drafted replies, and approve pending slot holds.
- **Multi-Turn Chat History Simulation**: Allow coordinators to view the full trace of tool calls and self-correction audit loops in the clinical workspace.


## Your Task

Implement the agent in `src/agent.ts`. It should read the `InboxItem[]` it receives, use the provided tools where appropriate, and return one output item per inbox item. `src/index.ts` wraps your items with `buildBatchOutput()` and writes the final `output.json`.

Available tools: `search_patient`, `verify_insurance`, `lookup_policy`, `find_slots`, `hold_slot`, `create_task`, `draft_message`, `escalate`.

Use `schema/output.schema.json` as the source of truth for the output shape. `data/example_output.json` shows one non-trivial worked item. It is illustrative and is not expected to pass validation by itself. **Do not copy the example call IDs** into your output — real outputs must use the `call_id` values returned by `getToolCallsForItem()`.

## Time Box

Spend about 2 hours. Suggested allocation: 20 minutes reading and designing, 70 minutes building, 20 minutes self-evaluating against the validator and the inbox, 10 minutes updating the README. Expected end-to-end runtime for `npm run triage` should be a few minutes or less; if your agent is much slower, that is worth noting in the README rather than optimizing under time pressure.

Minimum viable submission: processes every item in `data/inbox.json`, makes relevant tool calls including at least 3 distinct tools across the batch, writes a valid `output.json`, and passes `npm run validate`. Beyond that floor, your architecture, error handling, audit discipline, and scoping choices are part of what we evaluate.

## Constraints

- Use TypeScript, Node LTS, and npm. If this creates a real accessibility or environment issue, reach out.
- Use the provided tools in `src/tools.ts`; do not modify, reimplement, or bypass them. The tools create the audit trace used by the validator, so bypassing them fails validation.
- Use at least 3 distinct tools across the batch. Strong solutions use tools as part of the decision process across multiple items, not just once to satisfy the threshold. Irrelevant or performative tool calls will be penalized.
- Use `withItemContext(item.id, async () => ...)` around item-level tool calls.
- Use `getToolCallsForItem(item.id)` for `tools_called[]`; pass the returned entries through unchanged.
- Use `buildBatchOutput(items)` through the starter `src/index.ts`; do not hand-compute summary counts.
- Do not auto-send messages. Use `draft_message` only.
- Do not schedule appointments. `find_slots` and `hold_slot` are reviewable; scheduling is not.
- Use only synthetic data. Do not add real PHI.

## Urgency Calibration

- `P0`: safeguarding, imminent harm, mandated-reporter escalation. Same-hour human review.
- `P1`: same-day operational issue requiring prompt staff action.
- `P2`: normal intake, scheduling, billing, or clinical-review workflow.
- `P3`: low-priority admin, FYI, spam.

Default to `P2` unless there is a clear safety or same-day operational reason. Over-escalation is itself a production failure mode.

## Review Variants

Similar synthetic variants may be run during review. We will not tell you what they cover, but the visible 8 items show the kinds of cases we care about.

## Rubric

- Safety and domain judgment: 25%
- Tool orchestration and action model: 25%
- Output correctness and auditability: 20%
- Engineering quality: 15%
- README and production thinking: 15%

Draft replies should be clear, empathetic, concise, and operationally useful. They must not provide clinical advice or imply messages were sent.
