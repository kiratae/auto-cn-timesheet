"use client";

import { MoonIcon, SparklesIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { OptionPicker, type PickerOption } from "@/components/option-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DETAIL_MAX, type DayData, type Entry, REMARK_MAX, forRole, span } from "@/lib/rules";
import { cn } from "@/lib/utils";

// A draft entry on the page: the Entry sent to the API, plus a stable React key and the last submit error.
export type Draft = Entry & { key: number; submitError?: string };

export function EntryRow({
  draft,
  index,
  day,
  role,
  errors,
  onChange,
  onRemove,
}: {
  draft: Draft;
  index: number;
  day: DayData;
  role: string;
  errors: string[];
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}) {
  const inRole = forRole(day.options, role);
  const allowed = new Set(inRole.map((o) => o.task_type_id));
  // Only projects that have task types for the chosen role (plus the row's current one, so it never goes blank).
  const projectIds = new Set([...inRole.map((o) => o.project_id), draft.project_id]);
  const projects: PickerOption[] = [...new Map(day.options.filter((o) => projectIds.has(o.project_id)).map((o) => [o.project_id, o.project_name]))].map(
    ([value, label]) => ({ value, label }),
  );
  const tasks: PickerOption[] = day.options
    .filter((o) => o.project_id === draft.project_id && (allowed.has(o.task_type_id) || o.task_type_id === draft.project_task_type_id))
    .map((o) => ({ value: o.task_type_id, label: o.task_type_name, hint: o.description }));

  const setProject = (project_id: string) => {
    // Keep the task type if the new project has one with the same name (e.g. "Developer / Backend").
    const oldName = day.options.find((o) => o.task_type_id === draft.project_task_type_id)?.task_type_name;
    const match = day.options.find((o) => o.project_id === project_id && o.task_type_name === oldName);
    onChange({ project_id, project_task_type_id: match?.task_type_id ?? "", confidence: undefined });
  };

  const hasTime = /^\d{2}:\d{2}$/.test(draft.start) && /^\d{2}:\d{2}$/.test(draft.end);
  const [s, e] = hasTime ? span(draft.start, draft.end) : [0, 0];
  const mins = e - s;
  const nextDay = hasTime && draft.end <= draft.start;
  const lowConf = draft.confidence !== undefined && draft.confidence < day.jevMin;
  const pickInvalid = errors.some((m) => m.includes("project/task"));

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border bg-card p-3.5 shadow-xs transition-colors sm:p-4",
        errors.length > 0 && "border-destructive/50 bg-destructive/4",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">{index + 1}</span>
        <Input type="time" aria-label="Start" value={draft.start} onChange={(ev) => onChange({ start: ev.target.value })} className="w-[7.5rem] tabular-nums" />
        <span className="text-muted-foreground">–</span>
        <Input type="time" aria-label="End" value={draft.end} onChange={(ev) => onChange({ end: ev.target.value })} className="w-[7.5rem] tabular-nums" />
        {hasTime && mins > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.floor(mins / 60)}h{mins % 60 ? ` ${mins % 60}m` : ""}
          </span>
        )}
        {nextDay && (
          <Badge variant="outline" className="gap-1">
            <MoonIcon /> ends next day
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={draft.isWorkFromHome === true} onCheckedChange={(c) => onChange({ isWorkFromHome: c })} />
            WFH
          </label>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove entry ${index + 1}`}>
            <Trash2Icon />
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <OptionPicker value={draft.project_id} options={projects} placeholder="Select project" onChange={setProject} invalid={pickInvalid && !draft.project_id} />
        <OptionPicker
          value={draft.project_task_type_id}
          options={tasks}
          placeholder={draft.project_id ? "Select task type" : "Pick a project first"}
          disabled={!draft.project_id}
          onChange={(v) => onChange({ project_task_type_id: v, confidence: undefined })}
          invalid={pickInvalid}
        />
      </div>

      {draft.confidence !== undefined && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Badge variant={lowConf ? "destructive" : "secondary"} className="gap-1">
              {lowConf ? <TriangleAlertIcon /> : <SparklesIcon />}
              {lowConf ? "Check this pick · " : ""}Jev {Math.round(draft.confidence * 100)}%
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Jev&apos;s confidence in the project and task type. Changing either one clears it.</TooltipContent>
        </Tooltip>
      )}

      <div className="space-y-1">
        <Textarea
          aria-label="Detail"
          value={draft.detail}
          onChange={(ev) => onChange({ detail: ev.target.value })}
          placeholder="What was done (Thai)"
          className="min-h-20 resize-y"
        />
        <Counter n={draft.detail.length} max={DETAIL_MAX} />
      </div>
      <div className="space-y-1">
        <Input aria-label="Remark" value={draft.remark ?? ""} onChange={(ev) => onChange({ remark: ev.target.value })} placeholder="Remark (optional): blockers or notes" />
        <Counter n={(draft.remark ?? "").length} max={REMARK_MAX} />
      </div>

      {(errors.length > 0 || draft.submitError) && (
        <ul className="space-y-0.5 text-xs text-destructive">
          {errors.map((m) => (
            <li key={m}>• {m}</li>
          ))}
          {draft.submitError && <li>✗ Submit failed: {draft.submitError}</li>}
        </ul>
      )}
    </div>
  );
}

function Counter({ n, max }: { n: number; max: number }) {
  return <div className={cn("text-right text-[11px] tabular-nums text-muted-foreground", n > max && "text-destructive")}>{n}/{max}</div>;
}
