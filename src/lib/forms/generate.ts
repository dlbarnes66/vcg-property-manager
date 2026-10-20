import Anthropic from "@anthropic-ai/sdk";
import { aiModel } from "../ai/assistant";
import { db } from "../db";
import { isStateCode } from "../states";
import { dateToInput, todayUTC } from "../utils";
import { formType } from "./catalog";
import { gatherFacts, type Subject } from "./context";
import { firstHeading } from "./markdown";
import { revisePrompt, splitDraft, systemPrompt, userPrompt } from "./prompt";

/** Streams text from Claude; the last item carries token usage and why it stopped. Injectable for tests. */
export type Drafter = (p: Anthropic.MessageCreateParamsNonStreaming) => AsyncIterable<{ text?: string; usage?: { input: number; output: number }; stop?: string | null }>;

let sdk: Anthropic | null = null;
export const anthropicDrafter: Drafter = async function* (p) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("The AI isn't set up yet. Add ANTHROPIC_API_KEY to .env (see README).");
  sdk ??= new Anthropic();
  const stream = sdk.messages.stream(p);
  for await (const ev of stream) if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { text: ev.delta.text };
  const m = await stream.finalMessage();
  yield { usage: { input: m.usage.input_tokens, output: m.usage.output_tokens }, stop: m.stop_reason };
};

const MAX_TOKENS = 16000;
const CUT_OFF_NOTE = "- The draft hit the length limit and may be cut off at the end. Ask the AI to shorten it or to finish the last section.";

async function run(drafter: Drafter, system: string, user: string, onText?: (t: string) => void) {
  let text = "";
  let usage = { input: 0, output: 0 };
  let stop: string | null | undefined = null;
  for await (const chunk of drafter({ model: aiModel(), max_tokens: MAX_TOKENS, system, messages: [{ role: "user", content: user }] })) {
    if (chunk.text) {
      text += chunk.text;
      onText?.(chunk.text);
    }
    if (chunk.usage) usage = chunk.usage;
    if (chunk.stop !== undefined) stop = chunk.stop;
  }
  const { body, notes } = splitDraft(text);
  if (!body) throw new Error("The AI returned an empty draft. Please try again.");
  return { body, notes: stop === "max_tokens" ? [notes, CUT_OFF_NOTE].filter(Boolean).join("\n") : notes, usage };
}

export type DraftInput = Subject & { formType: string; state?: string | null; templateId?: string | null; instructions?: string | null; email?: string | null };

/** Drafts a new form and saves it as a draft. Returns the saved form. */
export async function draftForm(input: DraftInput, opts: { drafter?: Drafter; onText?: (t: string) => void } = {}) {
  const form = formType(input.formType);
  if (!form) throw new Error("Pick a form type");
  const { facts, links, state: subjectState } = await gatherFacts(input);
  const state = input.state && isStateCode(input.state) && input.state !== "US" ? input.state : subjectState;
  if (!state) throw new Error("Pick the state this form is for");
  const template = input.templateId ? await db.formTemplate.findUnique({ where: { id: input.templateId } }) : null;
  if (template && !template.body) throw new Error("That library item is an uploaded file; only text templates can be used as a starting point.");

  const { body, notes, usage } = await run(
    opts.drafter ?? anthropicDrafter,
    systemPrompt(state),
    userPrompt({ form, state, facts, instructions: input.instructions, template: template ? { title: template.title, body: template.body! } : null, today: dateToInput(todayUTC()) }),
    opts.onText,
  );
  return db.formDoc.create({
    data: {
      title: (firstHeading(body) ?? form.title).slice(0, 200), formType: form.key, state, category: form.category, body, reviewNotes: notes,
      instructions: input.instructions?.trim() || null, templateId: template?.id ?? null, ...links,
      model: aiModel(), inputTokens: usage.input, outputTokens: usage.output, createdByEmail: input.email ?? null,
    },
  });
}

/** Asks the AI to revise an existing form's text in place (status goes back to draft). */
export async function reviseForm(id: string, request: string, opts: { drafter?: Drafter; onText?: (t: string) => void } = {}) {
  if (!request.trim()) throw new Error("Say what you'd like changed");
  const doc = await db.formDoc.findUniqueOrThrow({ where: { id } });
  const { body, notes, usage } = await run(
    opts.drafter ?? anthropicDrafter,
    systemPrompt(doc.state),
    revisePrompt({ title: doc.title, state: doc.state, body: doc.body, request, today: dateToInput(todayUTC()) }),
    opts.onText,
  );
  return db.formDoc.update({
    where: { id },
    data: { body, reviewNotes: notes ?? doc.reviewNotes, status: "DRAFT", model: aiModel(), inputTokens: (doc.inputTokens ?? 0) + usage.input, outputTokens: (doc.outputTokens ?? 0) + usage.output },
  });
}
