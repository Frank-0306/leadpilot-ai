"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { checkDuplicatesAction } from "@/app/actions/leads";
import { Button, ButtonLink } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Field, Input, Select } from "@/components/ui/field";
import { IconAlert } from "@/components/ui/icons";
import { LEAD_SOURCES, LEAD_STATUSES, PROPERTY_LABELS, PROPERTY_TYPES, SOURCE_LABELS, STATUS_META } from "@/lib/domain";
import type { ActionResult, Agent, DuplicateMatch, Lead } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormAction = (prev: ActionResult<any> | null, form: FormData) => Promise<ActionResult<any>>;

/**
 * Create / edit form. Server action does the real validation; the browser
 * adds native constraints and an early duplicate check on blur.
 */
export function LeadForm({
  action,
  lead,
  agents,
  canAssign,
  defaultAgentId,
  cancelHref,
}: {
  action: FormAction;
  lead?: Lead;
  agents: Agent[];
  canAssign: boolean;
  defaultAgentId?: string | null;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [liveDuplicates, setLiveDuplicates] = useState<DuplicateMatch[]>([]);
  const confirmRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const serverDuplicates = state && !state.ok ? state.duplicates ?? [] : [];
  const duplicates = serverDuplicates.length ? serverDuplicates : liveDuplicates;

  async function checkDuplicates() {
    const form = formRef.current;
    if (!form) return;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value;
    const phone = (form.elements.namedItem("phone") as HTMLInputElement).value;
    if (!email && phone.replace(/\D/g, "").length < 7) return setLiveDuplicates([]);
    setLiveDuplicates(await checkDuplicatesAction(email, phone, lead?.id));
  }

  const v = (k: keyof Lead) => (lead?.[k] ?? "") as string;

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-8" noValidate={false}>
      <input ref={confirmRef} type="hidden" name="confirm_duplicate" defaultValue="0" />

      {state && !state.ok && !state.duplicates ? (
        <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      {duplicates.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-[color:var(--warning)]/40 bg-surface p-4" role="alert">
          <p className="flex items-center gap-2 text-sm font-medium">
            <IconAlert size={16} className="text-warning" />
            {serverDuplicates.length && state && !state.ok ? state.message : "Possible duplicate. Check before saving."}
          </p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-2">
                {d.can_open ? (
                  <Link href={`/leads/${d.id}`} className="font-medium text-accent hover:underline" target="_blank">
                    {d.full_name}
                  </Link>
                ) : (
                  <span className="font-medium">{d.full_name}</span>
                )}
                <span className="text-muted">
                  same {d.match_on.replace("+", " and ")}, {STATUS_META[d.status].label.toLowerCase()},{" "}
                  {d.owner_name ? `owned by ${d.owner_name}` : "unassigned"}
                </span>
              </li>
            ))}
          </ul>
          {serverDuplicates.length ? (
            <div>
              <Button
                type="submit"
                size="sm"
                onClick={() => {
                  if (confirmRef.current) confirmRef.current.value = "1";
                }}
              >
                Save anyway
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-[15px] font-semibold">Contact</legend>
        <Field label="Full name" htmlFor="full_name" error={errors.full_name} className="sm:col-span-2">
          <Input id="full_name" name="full_name" required minLength={2} maxLength={120} defaultValue={v("full_name")} autoComplete="off" invalid={!!errors.full_name} />
        </Field>
        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" maxLength={254} defaultValue={v("email")} onBlur={checkDuplicates} invalid={!!errors.email} />
        </Field>
        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input id="phone" name="phone" type="tel" maxLength={40} defaultValue={v("phone")} onBlur={checkDuplicates} placeholder="(555) 010-0000" invalid={!!errors.phone} />
        </Field>
        <Field label="Source" htmlFor="source" error={errors.source}>
          <Select id="source" name="source" defaultValue={lead?.source ?? "other"} required>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Stage" htmlFor="status" error={errors.status}>
          <Select id="status" name="status" defaultValue={lead?.status ?? "new_lead"}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-[15px] font-semibold">What they&apos;re looking for</legend>
        <Field label="Property type" htmlFor="property_type" error={errors.property_type} optional>
          <Select id="property_type" name="property_type" defaultValue={lead?.property_type ?? ""}>
            <option value="">Not specified</option>
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Budget (USD)" htmlFor="budget" error={errors.budget} optional>
          <Input id="budget" name="budget" inputMode="numeric" placeholder="450,000" defaultValue={lead?.budget ?? ""} invalid={!!errors.budget} />
        </Field>
        <Field label="Property of interest" htmlFor="property_interest" error={errors.property_interest} optional className="sm:col-span-2">
          <Input
            id="property_interest"
            name="property_interest"
            maxLength={300}
            defaultValue={v("property_interest")}
            placeholder="e.g. 3 bed near Lakeview schools, or a specific listing address"
          />
        </Field>
        <Field label="Preferred area" htmlFor="preferred_area" error={errors.preferred_area} optional>
          <Input id="preferred_area" name="preferred_area" maxLength={120} defaultValue={v("preferred_area")} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-5 sm:grid-cols-2">
        <legend className="mb-4 text-[15px] font-semibold">Ownership and follow-up</legend>
        <Field
          label="Responsible agent"
          htmlFor="assigned_agent_id"
          error={errors.assigned_agent_id}
          hint={canAssign ? undefined : "Leads you create are assigned to you."}
        >
          <Select
            id="assigned_agent_id"
            name="assigned_agent_id"
            defaultValue={lead ? (lead.assigned_agent_id ?? "") : (defaultAgentId ?? "")}
            disabled={!canAssign}
          >
            <option value="">Unassigned</option>
            {agents
              .filter((a) => a.is_active || a.id === lead?.assigned_agent_id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Next follow-up" htmlFor="next_follow_up_at" error={errors.next_follow_up_at} optional>
          <DateTimeField id="next_follow_up_at" name="next_follow_up_at" defaultIso={lead?.next_follow_up_at} />
        </Field>
      </fieldset>

      <div className="flex items-center gap-2 border-t border-line pt-5">
        <Button type="submit" variant="primary" loading={pending}>
          {lead ? "Save changes" : "Create lead"}
        </Button>
        <ButtonLink href={cancelHref} variant="ghost">
          Cancel
        </ButtonLink>
      </div>
    </form>
  );
}
