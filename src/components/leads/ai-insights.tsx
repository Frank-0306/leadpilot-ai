"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { approveAiDraftAction, generateAiAnalysisAction } from "@/app/actions/ai";
import { Button, Spinner } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { IconAlert, IconCheck } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { AiAnalysisRow } from "@/lib/types";

const LEVEL_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  High: { dot: "var(--stage-won)", text: "text-success", label: "High interest" },
  Medium: { dot: "var(--stage-negotiation)", text: "text-warning", label: "Medium interest" },
  Low: { dot: "var(--stage-new)", text: "text-muted", label: "Low interest" },
};

/** AI Lead Insights. Suggestions only: nothing is sent and nothing changes in the CRM without a person. */
export function AiInsights({
  leadId,
  leadEmail,
  latest,
  lastAttempt,
  configured,
}: {
  leadId: string;
  leadEmail: string | null;
  latest: AiAnalysisRow | null;
  lastAttempt: AiAnalysisRow | null;
  configured: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [generating, startGenerate] = useTransition();
  const [approving, startApprove] = useTransition();
  const [subject, setSubject] = useState(latest?.approved_subject ?? latest?.email_subject ?? "");
  const [body, setBody] = useState(latest?.approved_body ?? latest?.email_body ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSubject(latest?.approved_subject ?? latest?.email_subject ?? "");
    setBody(latest?.approved_body ?? latest?.email_body ?? "");
  }, [latest?.id, latest?.approved_subject, latest?.approved_body, latest?.email_subject, latest?.email_body]);

  const failedAfterLatest =
    lastAttempt && lastAttempt.status !== "succeeded" && lastAttempt.status !== "requested" && lastAttempt.id !== latest?.id ? lastAttempt : null;
  const edited = !!latest && (subject !== (latest.approved_subject ?? latest.email_subject) || body !== (latest.approved_body ?? latest.email_body));
  const approved = !!latest?.approved_at && !edited;

  function generate() {
    startGenerate(async () => {
      const res = await generateAiAnalysisAction(leadId);
      toast(res.ok ? (res.message ?? "AI analysis ready.") : res.message, res.ok ? "success" : "error");
      router.refresh();
    });
  }

  function approve() {
    if (!latest) return;
    startApprove(async () => {
      const res = await approveAiDraftAction({ analysisId: latest.id, subject, body });
      toast(res.ok ? (res.message ?? "Draft approved.") : res.message, res.ok ? "success" : "error");
      if (res.ok) router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't access the clipboard. Select the text and copy it manually.", "error");
    }
  }

  return (
    <section aria-labelledby="ai-title" className="overflow-hidden rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" className="text-accent">
          <path d="M10 2.5 11.6 8.4 17.5 10l-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6L10 2.5Z" fill="currentColor" />
        </svg>
        <h2 id="ai-title" className="text-[15px] font-semibold">
          AI Lead Insights
        </h2>
        {latest ? (
          <span className="text-[12.5px] text-muted" title={formatDateTime(latest.completed_at ?? latest.created_at)}>
            Last AI analysis {formatRelative(latest.completed_at ?? latest.created_at)}
            {latest.model ? `, ${latest.model.replace(/^models\//, "")}` : ""}
          </span>
        ) : null}
        <div className="ml-auto">
          {configured ? (
            <Button size="sm" variant={latest ? "secondary" : "primary"} onClick={generate} loading={generating}>
              {latest ? "Regenerate analysis" : "Generate analysis"}
            </Button>
          ) : null}
        </div>
      </header>

      {!configured ? (
        <div className="px-5 py-6 text-sm">
          <p className="font-medium">AI not configured</p>
          <p className="mt-1 max-w-xl text-muted">
            AI analysis is paused or not connected. An admin can turn on the AI Lead Analysis workflow in Automations once the Gemini credential is set up in n8n.
          </p>
        </div>
      ) : generating ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted" role="status">
          <Spinner className="text-accent" />
          Analyzing the lead&apos;s details with Gemini via n8n. This can take up to a minute.
        </div>
      ) : !latest ? (
        <div className="px-5 py-6 text-sm">
          <p className="font-medium">No AI analysis yet</p>
          <p className="mt-1 max-w-xl text-muted">
            Generate a summary, an interest level, a suggested next step and a follow-up email draft. Only commercial details are shared with the
            AI: first name, property interest, area, budget, stage and the prospect&apos;s own messages.
          </p>
          {failedAfterLatest ? <FailureNote row={failedAfterLatest} /> : null}
        </div>
      ) : (
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-5 bg-surface p-5">
            {failedAfterLatest ? <FailureNote row={failedAfterLatest} /> : null}
            <div>
              <p className="text-[12.5px] text-muted">Interest level</p>
              <p className={cn("mt-1 flex items-center gap-2 text-lg font-semibold", LEVEL_STYLE[latest.interest_level ?? "Low"]?.text)}>
                <span className="size-2.5 rounded-full" style={{ background: LEVEL_STYLE[latest.interest_level ?? "Low"]?.dot }} aria-hidden="true" />
                {LEVEL_STYLE[latest.interest_level ?? "Low"]?.label}
              </p>
              {latest.reasons?.length ? (
                <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted">
                  {latest.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden="true">·</span>
                      {r}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div>
              <p className="text-[12.5px] text-muted">Lead summary</p>
              <p className="mt-1 text-sm leading-relaxed">{latest.summary}</p>
            </div>
            <div>
              <p className="text-[12.5px] text-muted">Recommended next action</p>
              <p className="mt-1 text-sm leading-relaxed font-medium">{latest.next_action}</p>
            </div>
            <p className="text-[12px] text-faint">AI suggestions are guidance for the agent, not decisions. Check them against what you know about the client.</p>
          </div>

          <div className="flex flex-col gap-3 bg-surface p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12.5px] text-muted">Suggested follow-up message</p>
              {approved ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-success">
                  <IconCheck size={14} /> Approved {formatRelative(latest.approved_at)}
                </span>
              ) : (
                <span className="text-[12.5px] font-medium text-warning">Draft: needs your review</span>
              )}
            </div>
            <label htmlFor="ai-subject" className="sr-only">
              Subject
            </label>
            <Input id="ai-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} />
            <label htmlFor="ai-body" className="sr-only">
              Message
            </label>
            <Textarea id="ai-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={3000} className="min-h-64 text-[13.5px]" />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={approved ? "secondary" : "primary"} onClick={approve} loading={approving} disabled={approved}>
                {approved ? "Approved" : edited && latest.approved_at ? "Approve changes" : "Approve draft"}
              </Button>
              <Button size="sm" onClick={copy} disabled={!approved} title={approved ? undefined : "Approve the draft first"}>
                {copied ? "Copied" : "Copy draft"}
              </Button>
              {approved && leadEmail ? (
                <a
                  className="text-[13px] text-accent hover:underline"
                  href={`mailto:${encodeURIComponent(leadEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
                >
                  Open in email app
                </a>
              ) : null}
            </div>
            <p className="text-[12px] text-faint">LeadPilot never sends this message. After approving, copy it into your email and send it yourself.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function FailureNote({ row }: { row: AiAnalysisRow }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
      <IconAlert size={15} className="mt-0.5 shrink-0" />
      <span>
        Last attempt {row.status === "invalid_output" ? "was rejected by validation" : "failed"} ({formatRelative(row.completed_at ?? row.created_at)}):{" "}
        {row.error ?? "Unknown error"}
      </span>
    </p>
  );
}
