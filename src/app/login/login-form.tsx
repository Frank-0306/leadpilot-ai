"use client";

import { useActionState, useRef, useState } from "react";
import { signInAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export interface DemoCredentials {
  email: string;
  password: string;
}

export function LoginForm({ next, demo }: { next?: string; demo?: DemoCredentials | null }) {
  const [state, action, pending] = useActionState(signInAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function signInAsDemo() {
    if (!demo) return;
    setEmail(demo.email);
    setPassword(demo.password);
    // Let React commit the values, then sign in.
    requestAnimationFrame(() => formRef.current?.requestSubmit());
  }

  return (
    <div className="flex flex-col gap-6">
      {demo ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Exploring LeadPilot?</p>
            <p className="text-[13px] text-muted">
              Sign in as a demo admin. All leads are fictional; workspace settings are read-only and you can reset the data anytime.
            </p>
          </div>
          <Button type="button" onClick={signInAsDemo} disabled={pending} className="w-full">
            Use the demo account
          </Button>
          <p className="text-[12.5px] text-muted">
            {demo.email} / {demo.password}
          </p>
        </div>
      ) : null}

      <form ref={formRef} action={action} className="flex flex-col gap-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {state && !state.ok ? (
          <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            {state.message}
          </p>
        ) : null}
        <Field label="Work email" htmlFor="email">
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus={!demo}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" loading={pending} className="mt-1 w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}
