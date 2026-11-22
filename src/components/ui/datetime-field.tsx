"use client";

import { toDateTimeLocal } from "@/lib/format";
import { Input } from "./field";

/**
 * datetime-local input whose value is interpreted in the brokerage time zone
 * on the server (see fromDateTimeLocal), so it behaves the same everywhere.
 */
export function DateTimeField({
  id,
  name,
  defaultIso,
  required,
  invalid,
}: {
  id: string;
  name: string;
  defaultIso?: string | null;
  required?: boolean;
  invalid?: boolean;
}) {
  return <Input id={id} name={name} type="datetime-local" defaultValue={toDateTimeLocal(defaultIso)} required={required} invalid={invalid} />;
}
