"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheckIcon, CircleXIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ProgressState = {
  open: boolean;
  status: "running" | "done" | "error";
  t0: number;
  lines: { at: number; text: string; detail?: string; live?: boolean }[];
  titles: { running: string; done: string; error: string };
  note: string;
};

// Live step log for long runs: Generate (LLM thinking/writing, Jev picks, validation) and the LINE export.
// `onCancel` is passed only while the run can still be stopped safely (the LINE export's countdown).
export function ProgressDialog({
  state,
  onOpenChange,
  onCancel,
}: {
  state: ProgressState;
  onOpenChange: (open: boolean) => void;
  onCancel?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [state.status]);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect that returns
  // anything but a cleanup function crashes React ("destroy is not a function").
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.lines.length]);

  const last = state.lines.at(-1)?.at ?? 0;
  const elapsed = ((state.status === "running" ? now - state.t0 : last) / 1000).toFixed(1);
  const Icon = state.status === "running" ? Loader2Icon : state.status === "done" ? CircleCheckIcon : CircleXIcon;

  return (
    <Dialog open={state.open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              className={cn(
                "size-4",
                state.status === "running" && "animate-spin text-muted-foreground",
                state.status === "done" && "text-emerald-500",
                state.status === "error" && "text-destructive",
              )}
            />
            {state.titles[state.status]}
            <span className="ml-auto pr-8 font-mono text-xs font-normal tabular-nums text-muted-foreground">{elapsed}s</span>
          </DialogTitle>
          <DialogDescription>{state.note}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border bg-muted/30 p-2 font-mono text-xs">
          {state.lines.map((l, i) => (
            <div key={i} className={cn("flex gap-3 border-b border-dashed border-border/60 px-1.5 py-1 last:border-0", lineStyle(l.text))}>
              <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">+{(l.at / 1000).toFixed(1)}s</span>
              <div className="min-w-0 flex-1 break-words">
                {l.text}
                {l.detail && (
                  <div className="mt-1 whitespace-pre-wrap rounded border-l-2 border-border py-0.5 pl-2 font-sans text-[13px] leading-relaxed text-muted-foreground">
                    {l.detail}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <DialogFooter>
          {onCancel && (
            <Button variant="destructive" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {state.status === "running" ? "Hide" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lineStyle(text: string) {
  if (text.startsWith("…")) return "text-muted-foreground";
  if (text.startsWith("Taking control")) return "font-medium text-amber-600 dark:text-amber-400";
  if (text.startsWith("Cancelled")) return "text-muted-foreground";
  if (text.startsWith("✗")) return "text-destructive";
  if (text.includes("Jev picked")) return "font-medium text-foreground";
  if (text.startsWith("Validation found")) return "text-amber-600 dark:text-amber-400";
  if (text.startsWith("Validation passed")) return "text-emerald-600 dark:text-emerald-400";
  return "text-foreground/80";
}
