import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import type {
  InboxItem,
  ItemOutput,
  Discipline,
  PolicyTopic,
  Assignee,
  Classification,
  Urgency,
} from "./types.js";
import {
  search_patient,
  verify_insurance,
  lookup_policy,
  find_slots,
  hold_slot,
  create_task,
  draft_message,
  escalate,
  withItemContext,
  getToolCallsForItem,
} from "./tools.js";

// Retrieve API key and model configuration from loaded environment variables
const apiKey = process.env.ANTHROPIC_API_KEY;
const modelName = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

export async function runAgent(inbox: InboxItem[]): Promise<ItemOutput[]> {
  if (!apiKey) {
    throw new Error(
      "APIKeyMissingError: ANTHROPIC_API_KEY environment variable is not defined. A live Anthropic Claude API key is required to execute this agent.",
    );
  }

  const anthropic = new Anthropic({ apiKey });
  const outputs: ItemOutput[] = [];

  for (const item of inbox) {
    const output = await withItemContext(item.id, async () => {
      return await processItem(item, anthropic);
    });
    outputs.push(output);
  }

  return outputs;
}

const toolDefinitions = [
  {
    name: "search_patient",
    description: "Search for existing patients in the database by name and/or date of birth.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "First name, last name, or full name of the patient.",
        },
        dob: {
          type: "string",
          description: "Date of birth in YYYY-MM-DD format.",
        },
      },
    },
  },
  {
    name: "verify_insurance",
    description: "Verify active insurance coverage status, plans, copays, and prior authorization requirements.",
    input_schema: {
      type: "object",
      properties: {
        payer: {
          type: "string",
          description: "Name of the insurance carrier/payer.",
        },
        member_id: {
          type: "string",
          description: "The patient's insurance member ID.",
        },
      },
    },
  },
  {
    name: "lookup_policy",
    description: "Retrieve Cedar Kids Therapy policy snippets for clinic topics.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "service_lines",
            "insurance",
            "safeguarding",
            "clinical_advice",
            "scheduling",
            "cancellation",
            "language_access",
          ],
          description: "The clinic topic area to look up policy guidelines for.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "find_slots",
    description: "Search for available clinical slots for evaluations or treatments.",
    input_schema: {
      type: "object",
      properties: {
        discipline: {
          type: "string",
          enum: ["SLP", "OT", "PT"],
          description: "The clinical discipline requested (Speech, Occupational, or Physical Therapy).",
        },
        preferences: {
          type: "string",
          description: "Family slot timing preferences (e.g., mornings, afternoons, after school).",
        },
        language: {
          type: "string",
          description: "Preferred language for communication (e.g., 'es' for Spanish, 'en' for English).",
        },
      },
    },
  },
  {
    name: "hold_slot",
    description: "Place a temporary pending review hold on a slot for a patient. Out-of-network benefits discussion must happen first before a slot can be held.",
    input_schema: {
      type: "object",
      properties: {
        slot_id: {
          type: "string",
          description: "The slot ID to place a hold on.",
        },
        patient_ref: {
          type: "string",
          description: "The child's name, or patient ID if found in a database search.",
        },
      },
      required: ["slot_id", "patient_ref"],
    },
  },
  {
    name: "create_task",
    description: "Create an internal follow-up task assigned to clinic staff.",
    input_schema: {
      type: "object",
      properties: {
        assignee: {
          type: "string",
          enum: ["front_desk", "intake", "billing", "clinical_lead"],
          description: "The department or role to assign the follow-up task to.",
        },
        title: {
          type: "string",
          description: "Short, descriptive title of the follow-up action.",
        },
        due: {
          type: "string",
          description: "Due date in YYYY-MM-DD format. Dynamically calculate this based on item received_at: same-day/same-hour for safeguarding P0 or rescheduling P1, and 1-2 days out for normal P2 intakes.",
        },
        notes: {
          type: "string",
          description: "Detailed instructions and context for the assignee.",
        },
      },
      required: ["assignee", "title", "due", "notes"],
    },
  },
  {
    name: "draft_message",
    description: "Draft a follow-up message to the family or the referring provider. Do not auto-send.",
    input_schema: {
      type: "object",
      properties: {
        recipient: {
          type: "string",
          description: "Email address, phone number, portal username, or pediatrician office name.",
        },
        channel: {
          type: "string",
          enum: ["portal", "email", "phone"],
          description: "The communication channel to prepare the draft for.",
        },
        body: {
          type: "string",
          description: "Draft content. Must be clear, empathetic, concise, and must NOT provide clinical advice.",
        },
        language: {
          type: "string",
          enum: ["en", "es"],
          description: "Language code ('en' for English, 'es' for Spanish).",
        },
      },
      required: ["recipient", "channel", "body"],
    },
  },
  {
    name: "escalate",
    description: "Escalate urgent issues (P0 safeguarding child safety, or P1 same-day operational cancellations).",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "The ID of the inbox item being escalated.",
        },
        reason: {
          type: "string",
          description: "Detailed reason for the escalation.",
        },
        severity: {
          type: "string",
          enum: ["P0", "P1"],
          description: "P0 for child safeguarding/safety, P1 for same-day cancellations or reschedules.",
        },
      },
      required: ["item_id", "reason", "severity"],
    },
  },
  {
    name: "submit_triage_result",
    description: "Submit the final structured triage analysis block for this inbox item. Call this tool ONLY after you have completed all background tool calls (like search_patient, verify_insurance, create_task, draft_message, etc.) and are ready to finalize your triage.",
    input_schema: {
      type: "object",
      properties: {
        classification: {
          type: "string",
          enum: [
            "new_referral",
            "existing_patient_request",
            "scheduling",
            "clinical_question",
            "billing_question",
            "missing_paperwork",
            "provider_followup",
            "complaint",
            "safeguarding",
            "spam",
            "other"
          ],
          description: "The triage classification for this inbox item."
        },
        urgency: {
          type: "string",
          enum: ["P0", "P1", "P2", "P3"],
          description: "The calibrated urgency level."
        },
        extracted_intake: {
          type: "object",
          properties: {
            child_name: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Extracted name of the child/patient."
            },
            dob_or_age: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Extracted date of birth or age details."
            },
            parent_contact: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Extracted parent contact details (name, email, phone)."
            },
            discipline: {
              anyOf: [
                {
                  type: "array",
                  items: { type: "string", enum: ["SLP", "OT", "PT"] },
                  minItems: 1
                },
                { type: "null" }
              ],
              description: "List of requested disciplines."
            },
            diagnosis_or_concern: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "The child's diagnosis or core clinical concern."
            },
            payer: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Verified or stated insurance payer."
            },
            member_id: {
              anyOf: [{ type: "string" }, { type: "null" }],
              description: "Stated or verified member ID."
            }
          },
          required: ["child_name", "dob_or_age", "parent_contact", "discipline", "diagnosis_or_concern", "payer", "member_id"]
        },
        missing_info: {
          type: "array",
          items: { type: "string" },
          description: "List of missing critical fields from: child_name, dob_or_age, parent_contact, payer."
        },
        recommended_next_action: {
          type: "string",
          description: "Specific, actionable, high-quality next step for staff."
        },
        draft_reply: {
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Draft response to the family or the pediatrician office."
        },
        decision_rationale: {
          type: "string",
          description: "Clear, structured reasoning explaining the classification, urgency, and tool choices."
        }
      },
      required: ["classification", "urgency", "extracted_intake", "missing_info", "recommended_next_action", "draft_reply", "decision_rationale"]
    }
  }
];

async function processItem(item: InboxItem, anthropic: Anthropic): Promise<ItemOutput> {
  const systemPrompt = `You are an expert clinical intake triage agent for Cedar Kids Therapy, practicing on Monday, April 27, 2026.
Your goal is to triage the inbox item, coordinate with the clinic tools step-by-step, make decisions in alignment with clinic policies, and finalize your work by calling submit_triage_result.

Clinic Policies:
1. SERVICE LINES: Serves children ages 0-18 for SLP, OT, and PT. Confirm the requested discipline before scheduling.
2. INSURANCE: 
   - In-network: Aetna, Blue Cross Blue Shield, UnitedHealthcare, Medicaid.
   - Out-of-network (OON): Kaiser, Cigna Select, Beacon. 
   - Policy: Out-of-network referrals require a benefits conversation before any slot is held or recommended as ready to schedule.
   - Policy: Verified status from billing systems (via verify_insurance) supersedes payer info on documents. Surface discrepancies.
3. SAFEGUARDING: Any disclosure suggesting harm, abuse, neglect, or unsafe caregiving is P0. Escalate immediately (using escalate tool), create a task for the clinical_lead, and draft a neutral acknowledgment message (do not provide investigative advice).
4. CLINICAL ADVICE: Systems must not provide clinical advice over message. Clinical questions should be routed to screenings/evals. Draft replies can suggest these screens/evals.
5. SCHEDULING: Same-day cancellations or reschedules are P1 operational issues. Escalate to P1, find slots, and hold a slot ONLY if the parent explicitly mentions a preferred time that matches an available slot. Create front_desk task. Planned, future rescheduling requests (e.g. cancelling next week's session) must be calibrated as P2 (Standard Scheduling) and routed to intake.
6. LANGUAGE ACCESS: Spanish communication preference should be matched with a bilingual provider, and the response must be drafted in Spanish.

Triage Protocol (MUST Follow These Steps in Order):
1. SEARCH DATABASE: Always search for the patient first using search_patient to check if they are existing.
2. VERIFY INSURANCE: If insurance details are mentioned, verify coverage using verify_insurance.
3. POLICY RECOVERY: Retrieve relevant policy guidelines using lookup_policy (topics: "safeguarding", "scheduling", "insurance", "clinical_advice", "language_access", "service_lines") based on the text contents.
4. SLOT SELECTION: If the patient is ready for scheduling (in-network, clean referral):
   - Find slots using find_slots.
   - Check if the parent explicitly requested a preferred slot or timing that matches one of the slots.
   - If they did, place a hold using hold_slot. Otherwise, do not hold a slot.
5. ESCALATION: Call the escalate tool if the item contains P0 safeguarding or P1 same-day schedule items.
6. TASK ROUTING: Create an internal task for the team using create_task with logical parameters:
   - clinical_lead for P0 safeguarding.
   - front_desk for P1 cancellations/scheduling.
   - billing for out-of-network benefits reviews.
   - intake for normal scheduling or missing paperwork follow-ups.
7. DRAFT RESPONSE: Draft a professional, empathetic message to the parent (or referring pediatrician office if critical demographics are missing) using draft_message.
8. FINALIZE: You MUST call submit_triage_result to complete the triage process and return the final structured results. Do not stop calling tools until you call submit_triage_result.`;

  const userMessage = `Please triage this inbox item:
ID: ${item.id}
Channel: ${item.channel}
Received: ${item.received_at}
Sender: ${item.sender}
Subject: ${item.subject}
Body: ${item.body}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage }
  ];

  let response = await anthropic.messages.create({
    model: modelName,
    max_tokens: 2000,
    temperature: 0.1,
    system: systemPrompt,
    tools: toolDefinitions as any,
    messages
  });

  const taskIds: string[] = [];
  let escalationInfo: { reason: string; severity: "P0" | "P1" } | null = null;
  let finalResult: any = null;
  let auditRetries = 0;
  const maxAuditRetries = 2;

  // Tool coordination loop
  while (response.stop_reason === "tool_use") {
    messages.push({ role: "assistant", content: response.content });

    const toolResults: any[] = [];
    let shouldBreak = false;

    for (const contentBlock of response.content) {
      if (contentBlock.type === "tool_use") {
        const { name, input, id } = contentBlock;
        let resultData: any;

        try {
          if (name === "submit_triage_result") {
            const proposedResult = input as any;

            if (proposedResult.draft_reply && auditRetries < maxAuditRetries) {
              const auditSystemPrompt = `You are an expert clinical safety compliance auditor at Cedar Kids Therapy. 
Your task is to audit the drafted response to verify that it does NOT violate our clinical advice policy.

Clinical Advice Policy: Staff and automated systems must NOT provide clinical advice, medical diagnoses, prognosis, or treatment/therapy plans over messaging. Clinical questions must be redirected to evaluations, screenings, or clinician reviews.

Auditing Instructions:
- Carefully read the draft.
- If the draft suggests a diagnosis, prognosis, clinical cause, or specifies treatment details, it is a VIOLATION.
- If the draft redirects clinical questions to a screening or evaluation without offering advice, it is SAFE.
- Output exactly 'SAFE' if compliant.
- Output 'VIOLATION: <detailed explanation>' if it violates the policy. Do not include any other text.`;

              const auditResponse = await anthropic.messages.create({
                model: modelName,
                max_tokens: 150,
                temperature: 0.0,
                system: auditSystemPrompt,
                messages: [{ role: "user", content: `Please audit this draft: "${proposedResult.draft_reply}"` }]
              });

              const auditResultText = auditResponse.content[0].type === "text" ? auditResponse.content[0].text.trim() : "SAFE";
              if (auditResultText.startsWith("VIOLATION")) {
                auditRetries += 1;
                resultData = { 
                  data: { 
                    status: "error", 
                    message: `[CLINICAL SAFETY AUDIT REJECTION] Your proposed draft_reply was rejected for violating the clinical advice policy: ${auditResultText}. Please rewrite the draft_reply to contain absolutely zero clinical advice, diagnosis, or treatment suggestions, and redirect all clinical questions to a screening/evaluation. Try calling submit_triage_result again with the corrected draft.` 
                  } 
                };
              } else {
                finalResult = proposedResult;
                shouldBreak = true;
                resultData = { data: { status: "success", message: "Triage result received successfully." } };
              }
            } else {
              if (proposedResult.draft_reply && auditRetries >= maxAuditRetries) {
                proposedResult.draft_reply = `Dear family, thank you for reaching out. We have received your inquiry. Due to clinical safety regulations, our staff is unable to provide clinical advice or discuss symptoms over messaging. We would be happy to schedule a comprehensive evaluation or screening to address your concerns directly. An intake coordinator will contact you shortly to assist.`;
                proposedResult.decision_rationale += `\n\n[Clinical Safety Override: The drafted reply was modified by our compliance auditor to remove potential clinical advice after multiple audit violations.]`;
              }
              finalResult = proposedResult;
              shouldBreak = true;
              resultData = { data: { status: "success", message: "Triage result received successfully." } };
            }
          } else if (name === "search_patient") {
            resultData = await search_patient(input as any);
          } else if (name === "verify_insurance") {
            resultData = await verify_insurance(input as any);
          } else if (name === "lookup_policy") {
            resultData = await lookup_policy(input as any);
          } else if (name === "find_slots") {
            resultData = await find_slots(input as any);
          } else if (name === "hold_slot") {
            resultData = await hold_slot(input as any);
          } else if (name === "create_task") {
            resultData = await create_task(input as any);
            taskIds.push(resultData.data.task_id);
          } else if (name === "draft_message") {
            resultData = await draft_message(input as any);
          } else if (name === "escalate") {
            resultData = await escalate(input as any);
            escalationInfo = {
              reason: (input as any).reason,
              severity: (input as any).severity,
            };
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: JSON.stringify(resultData.data)
          });
        } catch (err: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: id,
            content: `Error: ${err.message}`,
            is_error: true
          });
        }
      }
    }

    messages.push({ role: "user", content: toolResults as any });

    if (shouldBreak) {
      break;
    }

    response = await anthropic.messages.create({
      model: modelName,
      max_tokens: 2000,
      temperature: 0.1,
      system: systemPrompt,
      tools: toolDefinitions as any,
      messages
    });
  }

  if (!finalResult) {
    throw new Error(
      `TriageFormatError: Claude completed the tool loop but failed to call submit_triage_result.`,
    );
  }

  // Retrieve exact tool calls logged for this item
  const toolsCalled = getToolCallsForItem(item.id);

  // Option C: Safeguarding (P0) Communication Override (Zero Outbound Communication)
  let finalDraftReply = finalResult.draft_reply;
  if (
    finalResult.urgency === "P0" || 
    finalResult.classification === "safeguarding" || 
    escalationInfo?.severity === "P0"
  ) {
    finalDraftReply = null;
  }

  return {
    item_id: item.id,
    classification: finalResult.classification as Classification,
    urgency: finalResult.urgency as Urgency,
    requires_human_review: true,
    extracted_intake: finalResult.extracted_intake,
    missing_info: finalResult.missing_info || [],
    tools_called: toolsCalled,
    recommended_next_action: finalResult.recommended_next_action,
    draft_reply: finalDraftReply,
    task_ids: taskIds,
    escalation: escalationInfo,
    decision_rationale: finalResult.decision_rationale,
  };
}
