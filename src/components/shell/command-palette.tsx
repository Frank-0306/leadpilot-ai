"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { searchAction, type SearchHit } from "@/app/actions/search";
import { Spinner } from "@/components/ui/button";
import { IconLeads, IconPlus, IconSearch, IconTasks } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

const OPEN_EVENT = "leadpilot:open-search";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Item {
  key: string;
  title: string;
  subtitle?: string;
  href: string;
  kind: "lead" | "task" | "action";
}

const QUICK_ACTIONS: Item[] = [
  { key: "a-new", title: "New lead", href: "/leads/new", kind: "action" },
  { key: "a-pipeline", title: "Open pipeline", href: "/pipeline", kind: "action" },
  { key: "a-overdue", title: "Overdue tasks", href: "/tasks?view=overdue", kind: "action" },
  { key: "a-unassigned", title: "Unassigned leads", href: "/leads?agent=unassigned", kind: "action" },
];

/** Global search (Ctrl/⌘ K): leads and tasks the user can access, plus quick actions. */
export function CommandPalette() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const requestId = useRef(0);

  useEffect(() => {
    const open = () => {
      dialogRef.current?.showModal();
      setTimeout(() => inputRef.current?.select(), 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) dialogRef.current.close();
        else open();
      }
    };
    window.addEventListener(OPEN_EVENT, open);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, open);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Debounced search; stale responses are ignored.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const id = ++requestId.current;
    const t = setTimeout(() => {
      startTransition(async () => {
        const result = await searchAction(q);
        if (id === requestId.current) {
          setHits(result);
          setActive(0);
        }
      });
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const items: Item[] = useMemo(() => {
    if (query.trim().length < 2) return QUICK_ACTIONS;
    return hits.map((h) => ({ key: `${h.kind}-${h.id}`, title: h.title, subtitle: h.subtitle, href: h.href, kind: h.kind }));
  }, [hits, query]);

  function go(item: Item | undefined) {
    if (!item) return;
    dialogRef.current?.close();
    setQuery("");
    router.push(item.href);
  }

  return (
    <dialog
      ref={dialogRef}
      className="mx-auto mt-[12vh] w-[min(94vw,580px)] animate-pop overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
      aria-label="Search"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
    >
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <IconSearch size={17} className="text-faint" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder="Search leads by name, email, phone or area…"
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          role="combobox"
          aria-expanded="true"
          aria-controls="search-results"
          aria-activedescendant={items[active] ? `search-${items[active].key}` : undefined}
        />
        {pending ? <Spinner className="text-faint" /> : null}
      </div>

      <ul id="search-results" role="listbox" className="max-h-[min(60vh,380px)] overflow-y-auto p-1.5">
        {query.trim().length < 2 ? <li className="px-2.5 pt-1.5 pb-1 text-[12px] text-faint">Jump to</li> : null}
        {items.map((item, i) => (
          <li
            key={item.key}
            id={`search-${item.key}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(item)}
            className={cn("flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2", i === active && "bg-sunken")}
          >
            <span className="text-faint">
              {item.kind === "lead" ? <IconLeads size={16} /> : item.kind === "task" ? <IconTasks size={16} /> : <IconPlus size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{item.title}</span>
              {item.subtitle ? <span className="block truncate text-[12.5px] text-muted">{item.subtitle}</span> : null}
            </span>
          </li>
        ))}
        {query.trim().length >= 2 && !pending && items.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted">No leads or tasks match “{query.trim()}”.</li>
        ) : null}
      </ul>
    </dialog>
  );
}
