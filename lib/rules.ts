// Pure rules shared by the server (lib/timesheet.ts, cli/) and the browser (app/, components/).
// No Node or Bun APIs here, so the client bundle can import it.

export type Slot = [number, number]; // [start, end] in minutes since local midnight; end may pass 1440

export type Option = {
  project_id: string;
  project_name: string;
  task_type_id: string;
  task_type_name: string;
  group: string; // task-type group = role, e.g. Developer, Devops, BusinessAnalyst
  description?: string;
};

export type Entry = {
  start: string;
  end: string;
  project_id: string;
  project_task_type_id: string;
  detail: string;
  remark?: string;
  feeling?: string;
  isWorkFromHome?: boolean;
  confidence?: number; // Jev's confidence in the project/task-type pick (0-1); UI flags low values
};

export type Existing = { start: string; end: string; label: string; detail: string; approved: boolean; wfh: boolean };
export type EntryError = { i: number; msg: string };
// text = the raw "Sender message" line (what filters and the LLM see); sender/body = split for chat display.
export type Msg = { id: string; group: string; date: string; time: string; text: string; sender: string; body: string; mine: boolean };
export type CommitFile = { path: string; oldPath?: string; status: "added" | "deleted" | "renamed" | "modified"; additions: number; deletions: number };
export type Commit = {
  id: string;
  project: string;
  title: string;
  message: string;
  time: string;
  url?: string;
  files: CommitFile[];
  additions: number;
  deletions: number;
};

// What GET /api/day returns (built by gather() in lib/timesheet.ts).
export type DayData = {
  date: string;
  work: Slot;
  lunch: Slot;
  jevMin: number;
  role: string; // default role from .env
  roles: string[];
  chat: Msg[];
  commits: Commit[];
  commitsError?: string; // GitLab is internal (VPN); when it's unreachable the day still loads without commits
  options: Option[];
  existing: Existing[];
  slots: Slot[]; // free work hours
  open: Slot[]; // anywhere an entry may go (today + into tomorrow morning)
};

export type SubmitResult = { i: number; ok: boolean; error?: string };

// One chat's outcome from scripts/line-export.ps1 (driven by lib/line-export.ts).
export type ChatExport = { chat: string; ok: boolean; bytes?: number; lines?: number; error?: string };

export const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
export const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// An end at or before the start means the entry runs past midnight (e.g. night deploy 23:00-01:00).
export const span = (start: string, end: string): Slot => {
  const s = toMin(start), e = toMin(end);
  return [s, e <= s ? e + 1440 : e];
};

// Object.groupBy isn't in Node 20, which runs the Next.js server.
export function groupBy<T>(xs: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of xs) (out[key(x)] ??= []).push(x);
  return out;
}

export function freeSlots(work: Slot, busy: Slot[]): Slot[] {
  let slots: Slot[] = [work];
  for (const [bs, be] of busy)
    slots = slots.flatMap(([s, e]) => ([[s, Math.min(e, bs)], [Math.max(s, be), e]] as Slot[]).filter(([a, b]) => a < b));
  return slots;
}

// Limit task types to exactly the specified role; unfiltered when no role is given.
export function forRole(options: Option[], role?: string) {
  return role ? options.filter((o) => o.group === role) : options;
}

export const FEELINGS = ["TERRIBLE", "BAD", "NEUTRAL", "GOOD", "GREAT"];
export const DETAIL_MAX = 5000;
export const REMARK_MAX = 255;

export function validateEntries(entries: Entry[], open: Slot[], options: Option[]): EntryError[] {
  const errs: EntryError[] = [];
  const add = (i: number, msg: string) => errs.push({ i, msg });
  entries.forEach((e, i) => {
    if (!/^\d{2}:\d{2}$/.test(e.start) || !/^\d{2}:\d{2}$/.test(e.end)) return add(i, "time must be HH:MM");
    const [s, t] = span(e.start, e.end);
    if (t - s > 720) add(i, "longer than 12h (end before start means next day)");
    else if (!open.some(([a, b]) => a <= s && t <= b)) add(i, "overlaps lunch or an existing entry");
    entries.forEach((o, j) => {
      if (j >= i) return;
      const [os, ot] = span(o.start, o.end);
      if (s < ot && os < t) add(i, `overlaps entry #${j + 1}`);
    });
    if (!options.some((o) => o.project_id === e.project_id && o.task_type_id === e.project_task_type_id))
      add(i, "unknown project/task type");
    if (!e.detail?.trim()) add(i, "detail required");
    else if (e.detail.length > DETAIL_MAX) add(i, `detail > ${DETAIL_MAX} chars`);
    if (/<[a-z/!]/i.test(e.detail || "")) add(i, "detail must not contain HTML");
    if ((e.remark?.length ?? 0) > REMARK_MAX) add(i, `remark > ${REMARK_MAX} chars`);
    if (e.feeling && !FEELINGS.includes(e.feeling)) add(i, `feeling must be one of ${FEELINGS.join("|")}`);
    if (e.isWorkFromHome !== undefined && typeof e.isWorkFromHome !== "boolean") add(i, "isWorkFromHome must be true/false");
  });
  return errs;
}
