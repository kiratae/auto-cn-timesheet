"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClockIcon, DownloadIcon, InboxIcon, PlusIcon, RefreshCwIcon, SendIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/date-picker";
import { DayTimeline } from "@/components/day-timeline";
import { type Draft, EntryRow } from "@/components/entry-row";
import { EvidencePanel } from "@/components/evidence-panel";
import { ProgressDialog, type ProgressState } from "@/components/progress-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cancelLineExport, exportLineStream, fetchDay, proposeStream, submitEntries } from "@/lib/api";
import { type DayData, type Slot, freeSlots, span, toHM, validateEntries } from "@/lib/rules";
import { cn } from "@/lib/utils";

const ALL = "__all";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const hours = (mins: number) => `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
// Not toLocaleDateString: Node and the browser ship different locale data ("Monday 28 September" vs
// "Monday, 28 September"), and the mismatch breaks hydration. Fixed format, same on both sides.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const formatDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const storedRole = () => {
  try {
    return localStorage.getItem("role");
  } catch {
    return null;
  }
};

export function TimesheetApp({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [day, setDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null); // null until the first load picks saved/.env default
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [progress, setProgress] = useState<ProgressState>({
    open: false,
    status: "done",
    t0: 0,
    lines: [],
    titles: { running: "", done: "", error: "" },
    note: "",
  });
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const busy = generating || exporting; // both drive long server runs; one at a time
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const nextKey = useRef(1);
  const loadSeq = useRef(0);

  // Only sets state after the fetch resolves; callers flip `loading` on first (it starts true for the first load).
  const load = useCallback(async (d: string) => {
    const seq = ++loadSeq.current; // ignore responses from an older date if the user clicks quickly
    try {
      const data = await fetchDay(d);
      if (seq !== loadSeq.current) return;
      setDay(data);
      setLoadError(null);
      setExcluded(new Set());
      setRole((r) => r ?? storedRole() ?? data.role);
    } catch (e) {
      if (seq === loadSeq.current) setLoadError(message(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);
  const reload = (d: string) => {
    setLoading(true);
    return load(d);
  };

  useEffect(() => {
    // Fetch on mount. load() only sets state after its await, so this doesn't cause a synchronous re-render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(initialDate);
  }, [initialDate, load]);

  const rowErrors = useMemo(() => {
    const errs = drafts.map(() => [] as string[]);
    if (day) for (const e of validateEntries(drafts, day.open, day.options)) errs[e.i].push(e.msg);
    return errs;
  }, [drafts, day]);
  const invalidCount = rowErrors.filter((e) => e.length).length;
  const draftMins = drafts.reduce((n, d) => {
    if (!/^\d{2}:\d{2}$/.test(d.start) || !/^\d{2}:\d{2}$/.test(d.end)) return n;
    const [s, e] = span(d.start, d.end);
    return n + (e - s);
  }, 0);
  const freeMins = (day?.slots ?? []).reduce((n, [a, b]) => n + (b - a), 0);

  const changeDate = (d: string) => {
    if (!d) return;
    setDrafts([]); // drafts belong to a day
    setDate(d);
    reload(d);
  };
  const changeRole = (r: string) => {
    setRole(r);
    try {
      localStorage.setItem("role", r);
    } catch {}
  };
  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch, submitError: undefined } : d)));

  const addRow = () => {
    if (!day) return;
    // Prefill the first free hour that no draft covers yet.
    const taken = drafts.filter((d) => d.start && d.end).map((d) => span(d.start, d.end));
    const gap = day.slots.flatMap((slot) => freeSlots(slot, taken))[0] as Slot | undefined;
    const start = gap ? toHM(gap[0]) : "";
    const end = gap ? toHM(Math.min(gap[1], gap[0] + 60)) : "";
    setDrafts((ds) => [
      ...ds,
      { key: nextKey.current++, start, end, project_id: "", project_task_type_id: "", detail: "", remark: "", feeling: "NEUTRAL", isWorkFromHome: false },
    ]);
  };

  // Opens the progress dialog for a new run and returns a function that appends a timed step line.
  const startProgress = (titles: ProgressState["titles"], note: string) => {
    const t0 = Date.now();
    setProgress({ open: true, status: "running", t0, lines: [], titles, note });
    // A live line (the LLM ticker) is replaced by whatever comes next instead of piling up.
    return (text: string, extra?: { detail?: string; live?: boolean }) =>
      setProgress((p) => {
        const keep = p.lines.at(-1)?.live ? p.lines.slice(0, -1) : p.lines;
        return { ...p, lines: [...keep, { at: Date.now() - t0, text, ...extra }] };
      });
  };
  const finishProgress = (status: "done" | "error") => {
    setProgress((p) => ({ ...p, status, open: true }));
    if (status === "done") setTimeout(() => setProgress((p) => (p.status === "done" ? { ...p, open: false } : p)), 1200);
  };

  const generate = async () => {
    if (!day) return;
    const push = startProgress(
      { running: "Generating entries…", done: "Entries ready", error: "Generation failed" },
      "You can close this; the entries appear in the list when it finishes.",
    );
    setGenerating(true);
    try {
      const r = await proposeStream(
        {
          date: day.date,
          chatIds: day.chat.filter((m) => !excluded.has(m.id)).map((m) => m.id),
          commitIds: day.commits.filter((c) => !excluded.has(c.id)).map((c) => c.id),
          role: role ?? "",
        },
        push,
      );
      setDrafts(r.entries.map((e) => ({ ...e, remark: e.remark ?? "", key: nextKey.current++ })));
      push(`✓ ${r.entries.length} entries drafted${r.errors.length ? `, ${r.errors.length} need fixing` : ""}`);
      finishProgress("done");
      if (r.errors.length) toast.warning(`${r.entries.length} entries drafted`, { description: "Some need fixing: see the red rows." });
      else toast.success(`${r.entries.length} entries drafted`, { description: "Review them before submitting." });
    } catch (e) {
      push(`✗ ${message(e)}`);
      finishProgress("error");
      toast.error("Generation failed", { description: message(e) });
    } finally {
      setGenerating(false);
    }
  };

  // Drives LINE for Windows to re-save each LINE_CHATS chat (scripts/line-export.ps1), then reloads the day.
  const exportLine = async () => {
    const pushLine = startProgress(
      { running: "Exporting LINE chats…", done: "LINE chats updated", error: "LINE export had problems" },
      "LINE is being operated automatically. Please don't touch the mouse or keyboard until it finishes.",
    );
    // Cancel is offered only during the script's 3 s countdown ("Taking control of the mouse in N…").
    const push = (text: string) => {
      if (text.startsWith("Taking control of the mouse in")) setCanCancel(true);
      else if (text === "Taking control now.") setCanCancel(false);
      pushLine(text);
    };
    setExporting(true);
    try {
      const { chats, cancelled } = await exportLineStream(push);
      if (cancelled) {
        setProgress((p) => ({ ...p, titles: { ...p.titles, done: "Export cancelled" } }));
        finishProgress("done");
        toast.info("LINE export cancelled", { description: "LINE was not touched." });
        return;
      }
      const failed = chats.filter((c) => !c.ok);
      push(`${failed.length ? "✗" : "✓"} ${chats.length - failed.length}/${chats.length} chats exported`);
      finishProgress(failed.length ? "error" : "done");
      if (failed.length) toast.warning(`${failed.length} chat${failed.length > 1 ? "s" : ""} not exported`, { description: failed.map((c) => `${c.chat}: ${c.error}`).join("\n") });
      else toast.success("LINE chats updated", { description: chats.map((c) => c.chat).join(", ") });
      await reload(date);
    } catch (e) {
      push(`✗ ${message(e)}`);
      finishProgress("error");
      toast.error("LINE export failed", { description: message(e) });
    } finally {
      setCanCancel(false);
      setExporting(false);
    }
  };

  const cancelExport = async () => {
    setCanCancel(false); // one click; the script confirms with "Cancelled. LINE was not touched."
    try {
      const { status } = await cancelLineExport();
      if (status === "too-late") toast.warning("Too late to cancel", { description: "The export had already taken control of LINE." });
    } catch (e) {
      toast.error("Couldn't cancel", { description: message(e) });
    }
  };

  const submitAll = async () => {
    if (!day) return;
    setSubmitting(true);
    try {
      const r = await submitEntries(day.date, drafts); // extra UI fields (key, submitError) are ignored server-side
      if (r.errors) {
        toast.error("The server rejected the entries", { description: r.errors.map((e) => `#${e.i + 1} ${e.msg}`).join("; ") });
        return;
      }
      const results = r.results ?? [];
      const failed = results.filter((x) => !x.ok);
      setDrafts(failed.map((x) => ({ ...drafts[x.i], submitError: x.error })));
      const ok = results.length - failed.length;
      if (failed.length) toast.warning(`${ok} created, ${failed.length} failed`, { description: "Failed entries are kept with their error." });
      else toast.success(`${ok} entries created on ${day.date}`);
      await reload(day.date);
    } catch (e) {
      toast.error("Submit failed", { description: message(e) });
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  };

  const roleItems = [{ label: "All roles", value: ALL }, ...(day?.roles ?? []).map((r) => ({ label: r, value: r }))];
  const dateLabel = formatDate(date);

  return (
    <div className="min-h-dvh bg-muted/40">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-3">
          <div className="mr-auto flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarClockIcon className="size-4" />
            </div>
            <div>
              <h1 className="text-sm leading-tight font-semibold">Timesheet Autofill</h1>
              <p className="text-xs text-muted-foreground">LINE + GitLab → ClickNext entries</p>
            </div>
          </div>
          <DatePicker value={date} onChange={changeDate} />
          <Select items={roleItems} value={role ? role : ALL} onValueChange={(v) => changeRole(!v || v === ALL ? "" : String(v))}>
            <SelectTrigger className="w-40" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleItems.map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" aria-label="Reload" onClick={() => reload(date)} disabled={loading}>
            <RefreshCwIcon className={cn(loading && "animate-spin")} />
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl items-start gap-4 px-4 py-5 lg:grid-cols-12">
        {loadError && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm lg:col-span-12">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-destructive">Couldn&apos;t load {date}</div>
              <div className="break-words text-muted-foreground">{loadError}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => reload(date)}>
              Retry
            </Button>
          </div>
        )}

        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>{dateLabel}</CardTitle>
              <CardDescription>
                {day ? `${day.existing.length} existing · ${hours(freeMins)} of work hours free` : "Loading…"}
              </CardDescription>
            </CardHeader>
            <CardContent>{day ? <DayTimeline day={day} entries={drafts} rowErrors={rowErrors} /> : <Skeleton className="h-24" />}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Evidence</CardTitle>
              <CardDescription>Untick anything that isn&apos;t your work before generating.</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" onClick={exportLine} disabled={busy}>
                  <DownloadIcon className={cn(exporting && "animate-bounce")} /> {exporting ? "Exporting…" : "Refresh from LINE"}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {day ? <EvidencePanel day={day} excluded={excluded} onExcludedChange={setExcluded} /> : <Skeleton className="h-72" />}
            </CardContent>
          </Card>
        </div>

        <Card className="lg:col-span-7">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              Entries
              {drafts.length > 0 && <Badge variant="secondary">{drafts.length}</Badge>}
              {invalidCount > 0 && <Badge variant="destructive">{invalidCount} to fix</Badge>}
            </CardTitle>
            <CardDescription>
              {drafts.length ? `${hours(draftMins)} drafted${role ? ` · role: ${role}` : ""}` : "Generate a draft from the evidence, or add rows by hand."}
            </CardDescription>
            <CardAction className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={addRow} disabled={!day}>
                <PlusIcon /> Add row
              </Button>
              <Button variant="outline" onClick={generate} disabled={!day || busy}>
                <SparklesIcon className={cn(generating && "animate-pulse")} /> {generating ? "Generating…" : "Generate"}
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={!drafts.length || invalidCount > 0 || submitting}>
                <SendIcon /> Submit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {drafts.length ? (
              <div className="space-y-3">
                {drafts.map((d, i) => (
                  <EntryRow
                    key={d.key}
                    draft={d}
                    index={i}
                    day={day!}
                    role={role ?? ""}
                    errors={rowErrors[i] ?? []}
                    onChange={(patch) => update(d.key, patch)}
                    onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-muted">
                  <InboxIcon className="size-5 text-muted-foreground" />
                </div>
                <div>
                  <div className="font-medium">No entries yet</div>
                  <div className="text-sm text-muted-foreground">Pick your evidence on the left, then press Generate.</div>
                </div>
                <Button onClick={generate} disabled={!day || busy}>
                  <SparklesIcon /> Generate entries
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <ProgressDialog state={progress} onOpenChange={(open) => setProgress((p) => ({ ...p, open }))} onCancel={canCancel ? cancelExport : undefined} />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Create {drafts.length} {drafts.length === 1 ? "entry" : "entries"} on {date}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hours(draftMins)} in total. They&apos;re posted to the ClickNext timesheet; unapproved entries can still be edited there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <Button onClick={submitAll} disabled={submitting}>
              {submitting ? "Submitting…" : "Create entries"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}
