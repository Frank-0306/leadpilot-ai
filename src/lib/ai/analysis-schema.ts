import { z } from "zod";

/**
 * Validation for AI output BEFORE anything is stored. The model is treated as
 * an untrusted source: wrong shape, out-of-range values, HTML/markup, links,
 * or reasoning that leans on sensitive personal characteristics are rejected
 * and recorded as "invalid_output" instead of being shown to agents.
 */

export const INTEREST_LEVELS = ["High", "Medium", "Low"] as const;
export type InterestLevel = (typeof INTEREST_LEVELS)[number];

const cleanText = (max: number) =>
  z
    .string()
    .transform((s) =>
      s
        .replace(/<[^>]*>/g, "") // no HTML
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control chars
        .replace(/[ \t]+\n/g, "\n")
        .trim(),
    )
    .pipe(z.string().min(1).max(max));

export const aiAnalysisSchema = z
  .object({
    interest_level: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().charAt(0).toUpperCase() + v.trim().slice(1).toLowerCase() : v),
      z.enum(INTEREST_LEVELS),
    ),
    summary: cleanText(600),
    reasons: z.array(cleanText(220)).min(1).max(4),
    next_action: cleanText(300),
    email_subject: cleanText(120),
    email_body: cleanText(2000),
  })
  .strip();

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

/**
 * Interest must be judged on commercial signals (budget, timeline, financing,
 * specificity, engagement) — never on who the person is. If the explanation
 * mentions protected characteristics the output is rejected.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(race|racial|ethnic(ity)?|skin colou?r)\b/i,
  /\b(religio(n|us)|church|mosque|synagogue|faith)\b/i,
  /\b(gender|male|female|woman|women)\b/i,
  /\b(age|aged|young|elderly|senior citizen|retiree|millennial|boomer)\b/i,
  /\b(nationality|national origin|immigrant|foreign(er)?|accent)\b/i,
  /\b(disab(led|ility)|handicap|pregnan(t|cy))\b/i,
  /\b(sexual orientation|gay|lesbian|straight)\b/i,
  /\b(marital|married|single parent|divorced|children|kids|familial)\b/i,
  /\b(name sounds|surname|last name)\b/i,
];

export function sensitiveReasoning(analysis: Pick<AiAnalysis, "reasons" | "summary">): string | null {
  const text = [...analysis.reasons, analysis.summary].join("\n");
  for (const p of SENSITIVE_PATTERNS) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

/** The draft must not contain links or claim it was already sent. */
export function unsafeDraft(analysis: Pick<AiAnalysis, "email_body" | "email_subject">): string | null {
  const text = `${analysis.email_subject}\n${analysis.email_body}`;
  if (/https?:\/\/|www\./i.test(text)) return "contains a link";
  if (/\{\{|\[(first ?name|name|agent)\]/i.test(text)) return "contains unfilled placeholders";
  return null;
}

/**
 * Model output arrives as text (possibly wrapped in ```json fences) or as an
 * object, depending on the n8n node settings. Return the parsed object or null.
 */
export function extractJson(raw: unknown): unknown {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type ValidationOutcome =
  | { status: "succeeded"; analysis: AiAnalysis }
  | { status: "invalid_output"; error: string };

export function validateAiOutput(raw: unknown): ValidationOutcome {
  const json = extractJson(raw);
  if (!json) return { status: "invalid_output", error: "The AI response was not valid JSON." };
  const parsed = aiAnalysisSchema.safeParse(json);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "response")))].join(", ");
    return { status: "invalid_output", error: `The AI response failed validation (${fields}).` };
  }
  const sensitive = sensitiveReasoning(parsed.data);
  if (sensitive) {
    return { status: "invalid_output", error: `Rejected: the explanation referred to a personal characteristic ("${sensitive}").` };
  }
  const draft = unsafeDraft(parsed.data);
  if (draft) return { status: "invalid_output", error: `Rejected: the email draft ${draft}.` };
  return { status: "succeeded", analysis: parsed.data };
}
