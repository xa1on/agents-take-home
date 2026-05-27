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

## Submission Details

### 1. How to Run

```bash
# Install dependencies
npm install

# Run the triage pipeline (processes input, writes output, logs traces)
npm run triage

# Run the validation suite to assert schema, tool usage, and policy compliance
npm run validate

# Run TypeScript compilation checks
npm run typecheck
```

The triage pipeline outputs the structured results to `output.json` and trace details to `.trace/tool-calls.jsonl`.

### 2. Stack and Runtime
- **Runtime**: Node.js (LTS), utilizing standard ECMAScript modules (`type: "module"`).
- **Languages & Bundler**: TypeScript 5.7+ with `tsx` (TypeScript Execute) for fast development execution.
- **AI / LLM Layer**: Anthropic Claude (`@anthropic-ai/sdk`) for cognitive intelligence when an `ANTHROPIC_API_KEY` is provided.
- **Fallback Layer**: Robust pattern-matching and regular expression heuristics for deterministic, zero-network, local execution.

### 3. Architecture
The agent is designed as a **Hybrid Heuristic-Cognitive Cognitive Architecture**:
1. **Dynamic Ingestion**: Reads the `InboxItem` array and executes wrapped processing inside `withItemContext` to maintain strict telemetry and audit tracking.
2. **Cognitive & Heuristic Parsing**:
   - Checks if `process.env.ANTHROPIC_API_KEY` is defined.
   - If present: Leverages Claude 3.5 Sonnet to perform semantic classification, extract demographics, verify intent, and draft highly custom, professional responses.
   - If absent: Drops back gracefully to a robust regex-based heuristic engine. The heuristics parse child names, DOBs, contact emails/phones, requested disciplines, and specific risk markers (cancellations, safeguarding issues, language preferences).
3. **Policy Coordination**:
   - **Safeguarding (P0)**: Flags abuse indicators, escalates severity to P0, drafts neutral replies, and routes a task to the `clinical_lead`.
   - **Same-Day Cancellations (P1)**: Recognizes urgent schedule drops, escalates to P1, drafts sick policies, and routes a task to the `front_desk`.
   - **Insurance Gatekeeping**: Verifies in-network vs. out-of-network status. For OON payers (e.g., Kaiser), creates a `billing` task and blocks slot holds.
   - **Language Access**: Matches Spanish preferences, drafts the final reply in Spanish, and schedules bilingually.
4. **Output Compilation**: Gathers the audit trail with `getToolCallsForItem` and exports compliant `ItemOutput`.

### 4. Failure Modes and Production Eval
- **Heuristic Limitations**: Natural language variations might bypass simple regex rules. In production, we evaluate accuracy by writing comprehensive unit/integration test suites on historical transcripts.
- **LLM Flakiness & Rate Limits**: Live APIs can time out, hallucinate, or hit rate limits. We address this by having our deterministic local heuristics act as a guaranteed safe fallback.
- **Context Overlaps**: An email might complain about billing *and* request a slot reschedule at the same time. The current architecture routes to a single classification; in production, we should support multi-label classification.
- **HIPAA & PHI Compliance**: Synthetic data must be strictly separated. In production, LLM prompts must utilize zero-retention API agreements or be run on locally-hosted private models (e.g., Llama 3 on private VPC) to protect Protected Health Information (PHI).

### 5. What I Chose Not to Build, and Why
- **Automatic Scheduling**: Bypassed executing holds for every patient. This is in strict adherence to the policy: "*Only hold a slot if the inbox item specifically mentions a preferred time that matches one of our available slots*," preventing clinic capacity locks.
- **Live Message Dispatching**: Left communication in "draft" status only. Automated clinical replies require human eyes for safety and compliance.
- **Database Modifying Tools**: Did not write tools to write directly to the database. Intake requires confirmation before committing records to prevent data contamination.

### 6. What I Would Do with Another 4 Hours
- **Multi-Label Triage Support**: Allow items to generate multiple tasks for different departments concurrently (e.g., a scheduling task and a billing task for the same referral).
- **Semantic Vector Search**: Integrate a local vector database (like `hnswlib` or similar) to match incoming referral diagnosis terms with the best-fit provider specialty tags in `providers.json`.
- **Bilingual Fallback Enhancement**: Improve the heuristic Spanish translator to generate highly specific, context-aware translation fragments for Spanish voicemail transcripts.
- **Interactive Triage Dashboard**: Build a lightweight Next.js/Vite frontend UI using Cedar Kids Therapy styling (clean, friendly, premium) to allow clinical coordinators to easily review, edit, approve, or dismiss the agent's drafted actions and messages.

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
