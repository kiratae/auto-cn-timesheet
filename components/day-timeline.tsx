"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type DayData, type Entry, span } from "@/lib/rules";
import { cn } from "@/lib/utils";

type Block = { s: number; e: number; label: string; tip: string; kind: "busy" | "lunch" | "new" | "bad" };

export function DayTimeline({ day, entries, rowErrors }: { day: DayData; entries: Entry[]; rowErrors: string[][] }) {
  const blocks: Block[] = [
    { s: day.lunch[0], e: day.lunch[1], label: "", tip: "Lunch", kind: "lunch" },
    ...day.existing.map((x) => {
      const [s, e] = span(x.start, x.end);
      return { s, e, label: x.label, tip: `${x.start}–${x.end} · ${x.label}`, kind: "busy" as const };
    }),
    ...entries.flatMap((x, i) => {
      if (!x.start || !x.end) return [];
      const [s, e] = span(x.start, x.end);
      const kind = rowErrors[i]?.length ? ("bad" as const) : ("new" as const);
      return [{ s, e, label: `#${i + 1} ${x.detail}`, tip: `#${i + 1} ${x.start}–${x.end} · ${x.detail || "(no detail)"}`, kind }];
    }),
  ];
  // Stretch the bar past work hours when anything (e.g. a night deploy) falls outside them.
  const ws = Math.floor(Math.min(day.work[0], ...blocks.map((b) => b.s)) / 60) * 60;
  const we = Math.ceil(Math.max(day.work[1], ...blocks.map((b) => b.e)) / 60) * 60;
  const len = we - ws;
  const pct = (m: number) => `${((m - ws) / len) * 100}%`;
  const step = len > 14 * 60 ? 2 : 1;
  const hours: number[] = [];
  for (let h = ws / 60; h * 60 <= we; h += step) hours.push(h);

  return (
    <div className="space-y-3">
      <div className="relative h-4 text-[11px] text-muted-foreground">
        {hours.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 tabular-nums" style={{ left: pct(h * 60) }}>
            {h % 24}
          </span>
        ))}
      </div>
      <div className="relative h-11 rounded-lg bg-muted/60 ring-1 ring-foreground/5">
        {/* work-hours band */}
        <div className="absolute inset-y-0 rounded-md bg-background/60" style={{ left: pct(day.work[0]), width: `${((day.work[1] - day.work[0]) / len) * 100}%` }} />
        {blocks.map((b, i) => (
          <Tooltip key={i}>
            <TooltipTrigger
              render={
                <div
                  className={cn(
                    "absolute inset-y-1 overflow-hidden rounded-md px-1.5 py-1 text-[11px] leading-tight text-ellipsis whitespace-nowrap",
                    b.kind === "busy" && "bg-zinc-400/70 text-white dark:bg-zinc-600",
                    b.kind === "lunch" && "bg-[repeating-linear-gradient(45deg,var(--color-border)_0_6px,transparent_6px_12px)]",
                    b.kind === "new" && "bg-blue-500 text-white shadow-sm",
                    b.kind === "bad" && "bg-destructive text-white shadow-sm",
                  )}
                  style={{ left: pct(b.s), width: pct(ws + (b.e - b.s)) }}
                />
              }
            >
              {b.label}
            </TooltipTrigger>
            <TooltipContent>{b.tip}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Legend className="bg-zinc-400/70 dark:bg-zinc-600">Existing</Legend>
        <Legend className="bg-blue-500">New</Legend>
        <Legend className="bg-destructive">Needs fixing</Legend>
        <Legend className="bg-[repeating-linear-gradient(45deg,var(--color-border)_0_3px,transparent_3px_6px)] ring-1 ring-border">Lunch</Legend>
      </div>
      {day.existing.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {day.existing.map((x, i) => (
            <li key={i} className="flex items-start gap-3 px-3 py-2">
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {x.start}–{x.end}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{x.label}</div>
                <div className="line-clamp-1 text-xs text-muted-foreground">{x.detail}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {x.wfh && <Badge variant="secondary">WFH</Badge>}
                {x.approved && <Badge variant="outline">Approved</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-sm", className)} />
      {children}
    </span>
  );
}
