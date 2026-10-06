// Server-side logic: LINE chat, GitLab, Timesheet API, LLM + Jev. Used by the Next.js route
// handlers (app/api/*) and the CLIs (cli/). Runs on Node or Bun, so no Bun-only APIs here.
/* eslint-disable @typescript-eslint/no-explicit-any -- raw JSON from GitLab/Timesheet/LLM/Jev is mapped into typed shapes right away */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Commit,
  type CommitFile,
  type DayData,
  type Entry,
  type EntryError,
  type Existing,
  type Msg,
  type Option,
  type Slot,
  type SubmitResult,
  forRole,
  freeSlots,
  groupBy,
  span,
  toHM,
  toMin,
  validateEntries,
} from "./rules";

const E = process.env;
const need = (k: string) => {
  const v = E[k];
  if (!v) throw new Error(`Missing ${k} in .env`);
  return v;
};

// ---------- time helpers (all "local" times are TZ_OFFSET)
const TZ = E.TZ_OFFSET || "+07:00";
const tzMin = (TZ[0] === "-" ? -1 : 1) * toMin(TZ.slice(1));
export const localDate = (ms = Date.now()) => new Date(ms + tzMin * 60000).toISOString().slice(0, 10);
const localHM = (iso: string) => new Date(Date.parse(iso) + tzMin * 60000).toISOString().slice(11, 16);
const toUtc = (date: string, hm: string, nextDay = false) =>
  new Date(Date.parse(`${date}T${hm}:00${TZ}`) + (nextDay ? 864e5 : 0)).toISOString();
const range = (s: string) => s.split("-").map(toMin) as Slot;
const WORK = range(E.WORK_HOURS || "09:00-18:00");
const LUNCH = range(E.LUNCH || "12:00-13:00");
export const JEV_MIN = Number(E.JEV_MIN_CONFIDENCE || 0.6); // below this a pick is flagged for review

// ---------- LINE chat
export function parseLine(text: string, group: string, me: string): Msg[] {
  const out: Msg[] = [];
  let date = "";
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const d = line.match(/^(\d{4})\.(\d{2})\.(\d{2}) [A-Za-z]+day$/);
    if (d) {
      date = `${d[1]}-${d[2]}-${d[3]}`;
      continue;
    }
    const m = line.match(/^(\d{2}:\d{2}) (.*)$/);
    if (m && date) out.push({ id: `${group}#${out.length}`, group, date, time: m[1], text: m[2], sender: "", body: "", mine: false });
    else if (out.length) out.at(-1)!.text += "\n" + line; // multi-line message continuation
  }
  // The export separates "HH:MM Sender message" with plain spaces, and names contain spaces ("พี่แบงค์ PM [CN]").
  // System lines ("P_CH Photos", "X left the group.") end in a known token, which reveals each exact name;
  // match every message against the longest known name, falling back to the first word.
  const names = new Set([me]);
  for (const x of out) {
    const first = x.text.split("\n")[0];
    if (LINE_EVENT.test(first)) names.add(first.replace(LINE_EVENT, ""));
  }
  const byLength = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const x of out) {
    x.text = x.text.trimEnd();
    const name = byLength.find((n) => x.text.startsWith(n + " ") || x.text === n) ?? x.text.split(" ")[0];
    x.sender = name;
    x.body = x.text.slice(name.length).trimStart();
    x.mine = name === me;
  }
  return out;
}

// Trailing tokens LINE writes for non-text events; they identify sender names and are dropped as noise.
const LINE_EVENT = / (Photos|Videos|Stickers|Files|Albums|unsent a message\.|\(emoji\)|left the group\.|joined the group\.)$/;
const NOISE = new RegExp(`${LINE_EVENT.source}|^Message unsent\\.$`);

// Keep: my messages, messages mentioning me, and the message right before each of my replies.
export function filterChat(msgs: Msg[], date: string, pats: RegExp[]) {
  const day = msgs.filter((m) => m.date === date && !NOISE.test(m.text));
  return day.filter((m, i) => m.mine || pats.some((p) => p.test(m.text)) || day[i + 1]?.mine);
}

function readChat(date: string) {
  // The chat exports are user data read at runtime, not app files; tell Turbopack not to trace/bundle them.
  const dir = resolve(/*turbopackIgnore: true*/ E.LINE_DIR || "."); // relative to the project root (cwd); absolute works too
  const pats = (E.ME_PATTERNS || "kiratae,เต้(?![นา]),@All").split(",").map((p) => new RegExp(p.trim(), "i"));
  return readdirSync(/*turbopackIgnore: true*/ dir)
    .filter((f) => f.startsWith("[LINE]") && f.endsWith(".txt"))
    .flatMap((f) => {
      const file = join(/*turbopackIgnore: true*/ dir, f);
      return filterChat(parseLine(readFileSync(/*turbopackIgnore: true*/ file, "utf8"), f.slice(6, -4), E.ME_NAME || "kiratae"), date, pats);
    });
}

// ---------- GitLab
async function gl(path: string) {
  const r = await fetch(`${need("GITLAB_URL").replace(/\/$/, "")}/api/v4${path}`, { headers: { "PRIVATE-TOKEN": need("GITLAB_TOKEN") } });
  if (!r.ok) throw new Error(`GitLab ${r.status} ${path}: ${await r.text()}`);
  return r;
}

async function glAll(path: string) {
  const out: any[] = [];
  for (let page = "1"; page; ) {
    const r = await gl(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    out.push(...(await r.json()));
    page = r.headers.get("x-next-page") || "";
  }
  return out;
}

async function getCommits(date: string): Promise<Commit[]> {
  if (!E.GITLAB_URL) return [];
  const emails = need("GIT_AUTHOR_EMAILS").toLowerCase().split(",").map((s) => s.trim());
  const shift = (d: number) => localDate(Date.parse(`${date}T12:00:00${TZ}`) + d * 864e5);
  // Push events tell us which projects to look at; the commits API gives the actual authored commits.
  const events = await glAll(`/events?action=pushed&after=${shift(-1)}&before=${shift(1)}`);
  const since = encodeURIComponent(`${date}T00:00:00${TZ}`);
  const until = encodeURIComponent(`${date}T23:59:59${TZ}`);
  const seen = new Set<string>();
  const out: Commit[] = [];
  for (const pid of new Set(events.map((e) => e.project_id))) {
    const proj = await (await gl(`/projects/${pid}`)).json();
    const mine = (await glAll(`/projects/${pid}/repository/commits?all=true&since=${since}&until=${until}`)).filter(
      (c) => !seen.has(c.id) && emails.includes(String(c.author_email).toLowerCase()),
    );
    for (const c of mine) seen.add(c.id);
    // One diff call per commit (a day is usually a handful), in parallel.
    const files = await Promise.all(mine.map((c) => commitFiles(pid, c.id)));
    mine.forEach((c, i) =>
      out.push({
        id: c.id,
        project: proj.path_with_namespace,
        title: c.title,
        message: c.message.trim(),
        time: localHM(c.authored_date),
        url: c.web_url,
        files: files[i],
        additions: files[i].reduce((n, f) => n + f.additions, 0),
        deletions: files[i].reduce((n, f) => n + f.deletions, 0),
      }),
    );
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

async function commitFiles(pid: number, sha: string): Promise<CommitFile[]> {
  const diffs = await glAll(`/projects/${pid}/repository/commits/${sha}/diff`);
  return diffs.map((d) => {
    const lines: string[] = (d.diff ?? "").split("\n");
    return {
      path: d.new_path,
      oldPath: d.renamed_file ? d.old_path : undefined,
      status: d.new_file ? "added" : d.deleted_file ? "deleted" : d.renamed_file ? "renamed" : "modified",
      // GitLab omits the diff text for very large files; those show 0/0.
      additions: lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
      deletions: lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
    };
  });
}

// ---------- Timesheet API
async function ts(method: string, path: string, body?: unknown) {
  const r = await fetch(`${E.TIMESHEET_BASE_URL || "https://timesheet.clicknext.com"}/api/open/dev/v1${path}`, {
    method,
    headers: { "x-api-key": need("TIMESHEET_API_KEY"), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Timesheet ${r.status} ${method} ${path}: ${JSON.stringify(j)}`);
  return j;
}

export const getOptions = async (): Promise<Option[]> =>
  (await ts("GET", "/projects")).data.flatMap((p: any) =>
    p.taskTypes.flatMap((g: any) =>
      g.items.map((it: any) => ({
        project_id: p.id,
        project_name: p.code ? `${p.code} ${p.name}` : p.name,
        task_type_id: it.id,
        task_type_name: `${g.name} / ${it.name}`,
        group: g.name,
        description: it.description || undefined,
      })),
    ),
  );

export async function dayState(date: string) {
  const { data } = await ts("GET", `/time-sheets/${date}`);
  const existing: Existing[] = data.map((t: any) => ({
    start: localHM(t.start_date),
    end: localHM(t.end_date),
    label: `${t.project_name} / ${t.task_type_name}`,
    detail: t.detail,
    approved: t.is_approved,
    wfh: t.isWorkFromHome,
  }));
  const busy = [...existing.map((x) => span(x.start, x.end)), LUNCH];
  // slots: free work hours (what the LLM should fill). open: anywhere today or into tomorrow morning (what is allowed).
  return { existing, slots: freeSlots(WORK, busy), open: freeSlots([0, 2880], busy) };
}

// ---------- LLM (OpenAI-compatible)
// With a Jev key, Jev picks project/task type (it's built for choosing from a list and reports confidence);
// the LLM only splits the day and writes text, plus an English summary + sources for Jev to decide on.
const jevEnabled = () => !!E.JEV_API_KEY;
export type AppConfig = ReturnType<typeof appConfig>;
// Shown in the UI header: which LLM, GitLab and LINE sources this server reads. Never includes keys/tokens.
export const appConfig = () => {
  const host = (u?: string) => {
    try {
      return new URL(u || "").host;
    } catch {
      return null;
    }
  };
  const list = (s?: string) => (s || "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    llm: { provider: host(E.OPENAI_BASE_URL) ?? "not set", model: E.OPENAI_MODEL || "not set", jev: jevEnabled() ? E.JEV_MODEL || "jev-latest" : null },
    git: { host: host(E.GITLAB_URL), emails: list(E.GIT_AUTHOR_EMAILS) }, // no host = commits skipped (getCommits)
    line: {
      dir: resolve(/*turbopackIgnore: true*/ E.LINE_DIR || "."),
      me: E.ME_NAME || "kiratae",
      patterns: E.ME_PATTERNS || "kiratae,เต้(?![นา]),@All",
      chats: list(E.LINE_CHATS),
    },
  };
};
const SYSTEM = () => `You fill a developer's daily timesheet. The user is "${E.ME_NAME || "kiratae"}" (also called เต้ / พี่เต้).
Return JSON only: {"entries":[{"start":"HH:MM","end":"HH:MM",${
  jevEnabled() ? `"summary_en":"...","sources":"..."` : `"option":12`
},"detail":"...","remark":"","feeling":"NEUTRAL"}]}
Rules:${
  jevEnabled()
    ? `
- summary_en: one English sentence saying what kind of work it is (development, bug fix, support, deploy, meeting, documentation...) and for which system/customer.
- sources: the LINE group names and GitLab project paths this entry came from.`
    : `
- option: the number of the best-fitting task type from TASK CATALOG (listed under its project). Prefer the customer project the work belongs to.`
}
- Split the day into distinct tasks: code work (from commits), support requests (from chat), deploys, meetings.
- Work-hour entries must lie entirely inside ONE free slot. Entries must not overlap. Together they should fill the free slots.
- Work outside work hours (e.g. a night deploy 23:00-01:00): add a separate entry at the exact time stated in chat, only when chat clearly says the user does it that day. It must not overlap "busy". An end earlier than the start means it ends the next day.
- Use meeting times stated in chat when given; otherwise estimate from message/commit times and effort.
- detail: Thai, concise plain text (no HTML), max 5000 chars. Mention company names, ticket/claim codes and what was done.
- remark: optional, max 255 chars, only blockers or notes.
- Only include work the user did or was asked to do; ignore unrelated chat.`;

// One line of progress: what step is running, how long it has taken, and (when there's
// something to show) a snippet of what the LLM/Jev is actually saying or deciding.
// `live` lines replace the previous live line (a ticker) instead of piling up; `detail` is shown under the text.
export type Progress = (e: { text: string; detail?: string; live?: boolean }) => void;
export const since = (t0: number) => ((Date.now() - t0) / 1000).toFixed(1) + "s";
// Last ~n chars of streamed prose, cut at a word boundary and without markdown noise, so it reads as text.
const tail = (s: string, n = 280) => {
  const t = s.replace(/[*#`]+/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(-n);
  return "…" + cut.slice(cut.indexOf(" ") + 1);
};
// What the model is writing, read from its partial JSON: which entry, its time range and the detail so far.
export const writingNow = (out: string) => {
  const n = out.match(/"start"\s*:/g)?.length ?? 0;
  const str = (k: string) => [...out.matchAll(new RegExp(String.raw`"${k}"\s*:\s*"((?:[^"\\]|\\.)*)`, "g"))].at(-1)?.[1] ?? "";
  const range = str("start") && `${str("start")}-${str("end")}`;
  return { text: n ? `LLM writing entry ${n}${range ? ` (${range})` : ""}` : "LLM writing", detail: tail(str("detail").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, " ").replace(/\\(.)/g, "$1"), 200) };
};
const clip = (s: string, n = 1500) => (s.length > n ? s.slice(0, n) + " …" : s);
// Changed file paths help the LLM describe the work; capped so a huge commit can't flood the prompt.
const filesLine = (c: Commit) =>
  c.files.length ? `\n  files: ${c.files.slice(0, 15).map((f) => f.path).join(", ")}${c.files.length > 15 ? ` (+${c.files.length - 15} more)` : ""}` : "";

async function llm(messages: { role: string; content: string }[], onProgress?: Progress) {
  const t0 = Date.now();
  const r = await fetch(`${need("OPENAI_BASE_URL").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${need("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    // Streaming so bytes flow while the model thinks; a proxy (Cloudflare) kills silent requests after 100s.
    body: JSON.stringify({ model: need("OPENAI_MODEL"), messages, temperature: 0.2, response_format: { type: "json_object" }, stream: true }),
  });
  if (!r.ok) throw new Error(`LLM ${r.status}: ${clip((await r.text()).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), 400)}`);
  let out = "", reasoning = "", buf = "", lastEmit = 0;
  const dec = new TextDecoder();
  for await (const chunk of r.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!data || data === "[DONE]") continue;
      const d = JSON.parse(data).choices?.[0]?.delta ?? {};
      reasoning += d.reasoning_content ?? d.reasoning ?? "";
      out += d.content ?? "";
    }
    if (onProgress && Date.now() - lastEmit > 400) {
      lastEmit = Date.now();
      const w = out ? writingNow(out) : { text: "LLM thinking", detail: tail(reasoning) };
      onProgress({ text: `${w.text}… (${since(t0)})`, detail: w.detail || undefined, live: true });
    }
  }
  onProgress?.({ text: `LLM finished in ${since(t0)} (${out.length} chars)` });
  return out;
}

const parseEntries = (content: string): any[] => {
  const s = content.replace(/<think>[\s\S]*?<\/think>/g, ""); // reasoning models may inline their thoughts
  return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)).entries ?? [];
};

// Compact catalog: each project name once, then "<index> <task type>". Sending the raw options
// (943 rows with two UUIDs each) blew past a 131k-token context window.
const catalog = (options: Option[]) =>
  Object.entries(groupBy(options.map((o, n) => ({ ...o, n })), (o) => o.project_name))
    .map(([project, os]) => `${project}\n${os.map((o) => `  ${o.n} ${o.task_type_name}`).join("\n")}`)
    .join("\n");

// ---------- Jev (TypeSafe System One): typed Choice questions with calibrated confidence
async function jev(state: unknown, questions: Record<string, unknown>) {
  const r = await fetch(`${(E.JEV_BASE_URL || "https://api.typesafe.ai/v1").replace(/\/$/, "")}/systemone`, {
    method: "POST",
    headers: { Authorization: `Bearer ${need("JEV_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ state, model: E.JEV_MODEL || "jev-latest", questions }),
  });
  if (!r.ok) throw new Error(`Jev ${r.status}: ${clip(await r.text(), 400)}`);
  return ((await r.json()) as any).answers;
}

const choice = (instructions: string, criteria: Record<string, string | null>) => ({ type: "choice", instructions, criteria });

// Two steps because a Choice allows at most 255 options (we have ~950): project first, then its task types.
// Sequential per entry (not Promise.all) so progress lines come out in a sane order to watch.
async function jevPick(raw: any[], options: Option[], onProgress?: Progress): Promise<Entry[]> {
  const projects = Object.fromEntries(options.map((o) => [o.project_name, null]));
  const out: Entry[] = [];
  for (const [i, { summary_en, sources, ...e }] of raw.entries()) {
    const label = `Entry ${i + 1} (${e.start}-${e.end})`;
    const state = { work: summary_en, sources, detail_th: e.detail };
    onProgress?.({ text: `${label}: Jev choosing project for "${summary_en}"…` });
    let t0 = Date.now();
    const p = (await jev(state, { p: choice("Which project should this work be logged under?", projects) })).p;
    onProgress?.({ text: `${label}: Jev picked project "${p.choice}" (${Math.round(p.confidence * 100)}% confidence, ${since(t0)})` });
    const tasks = options.filter((o) => o.project_name === p.choice);
    const criteria = Object.fromEntries(tasks.map((o) => [o.task_type_name, o.description ?? null]));
    onProgress?.({ text: `${label}: Jev choosing task type under "${p.choice}"…` });
    t0 = Date.now();
    const t = (await jev(state, { t: choice("Which task type best describes this work?", criteria) })).t;
    onProgress?.({ text: `${label}: Jev picked task type "${t.choice}" (${Math.round(t.confidence * 100)}% confidence, ${since(t0)})` });
    const o = tasks.find((x) => x.task_type_name === t.choice);
    out.push({ ...e, project_id: o?.project_id ?? "", project_task_type_id: o?.task_type_id ?? "", confidence: Math.min(p.confidence, t.confidence) });
  }
  return out;
}

export async function propose(day: DayData, chat: Msg[], commits: Commit[], role?: string, onProgress?: Progress) {
  const opts = forRole(day.options, role);
  const projectCount = new Set(opts.map((o) => o.project_id)).size;
  onProgress?.({
    text: `Preparing prompt: ${chat.length} chat messages, ${commits.length} commits, ${opts.length} project/task-type options across ${projectCount} projects${role ? ` (role: ${role})` : ""}`,
  });
  const messages = [
    { role: "system", content: SYSTEM() },
    {
      role: "user",
      content: [
        `DATE: ${day.date}`,
        `FREE SLOTS (work hours): ${day.slots.map(([a, b]) => `${toHM(a)}-${toHM(b)}`).join(", ") || "none"}`,
        `BUSY (existing entries): ${day.existing.map((x) => `${x.start}-${x.end}`).join(", ") || "none"}`,
        `\nCHAT:\n${chat.map((m) => `[${m.group} ${m.time}] ${clip(m.text)}`).join("\n") || "(none)"}`,
        `\nCOMMITS:\n${commits.map((c) => `[${c.time} ${c.project}] ${clip(c.message)}${filesLine(c)}`).join("\n") || "(none)"}`,
        role ? `\nUSER ROLE: ${role}` : "",
        jevEnabled() ? "" : `\nTASK CATALOG:\n${catalog(opts)}`,
      ].join("\n"),
    },
  ];
  let entries: Entry[] = [];
  let errors: EntryError[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    onProgress?.({ text: attempt === 0 ? "Asking the LLM to draft entries…" : "Asking the LLM to fix the errors…" });
    const content = await llm(messages, onProgress);
    const raw = parseEntries(content);
    onProgress?.({
      text: `LLM drafted ${raw.length} entries` + (jevEnabled() ? "; asking Jev to pick project/task type for each…" : ""),
      detail: raw.map((e, i) => `#${i + 1}  ${e.start}-${e.end}  ${clip(String(e.summary_en || e.detail || "").replace(/\s+/g, " "), 140)}`).join("\n"),
    });
    entries = (
      jevEnabled()
        ? await jevPick(raw, opts, onProgress)
        : raw.map(({ option, ...e }) => ({
            ...e,
            project_id: opts[option]?.project_id ?? "",
            project_task_type_id: opts[option]?.task_type_id ?? "",
          }))
    ).map((e) => ({ ...e, isWorkFromHome: E.WFH_DEFAULT === "true" })); // LLM can't know WFH; user toggles
    errors = validateEntries(entries, day.open, day.options);
    onProgress?.({ text: errors.length ? `Validation found ${errors.length} problem(s): ${errors.map((e) => `#${e.i + 1} ${e.msg}`).join("; ")}` : "Validation passed" });
    if (!errors.length) break;
    messages.push(
      { role: "assistant", content },
      { role: "user", content: `Fix these errors and return the full JSON again:\n${errors.map((e) => `entry ${e.i + 1}: ${e.msg}`).join("\n")}` },
    );
  }
  return { entries, errors };
}

// ---------- orchestration
export async function gather(date: string): Promise<DayData> {
  let commitsError: string | undefined;
  const [commits, options, state] = await Promise.all([
    // Commits are optional evidence: GitLab sits on the office network, so a dropped VPN must not break the day.
    getCommits(date).catch((e: Error): Commit[] => {
      const cause = (e.cause as { code?: string } | undefined)?.code;
      commitsError = `GitLab unreachable (${cause ?? e.message}). On VPN / office network?`;
      return [];
    }),
    getOptions(),
    dayState(date),
  ]);
  const roles = [...new Set(options.map((o) => o.group))].sort();
  return { date, work: WORK, lunch: LUNCH, jevMin: JEV_MIN, role: E.ROLE || "", roles, chat: readChat(date), commits, commitsError, options, ...state };
}

// /api/propose reuses what /api/day just fetched, instead of calling GitLab and the Timesheet API again.
const dayCache = new Map<string, DayData>();
export const clearDayCache = () => dayCache.clear(); // after re-exporting LINE chats

export async function gatherCached(date: string, fresh = false) {
  if (fresh || !dayCache.has(date)) dayCache.set(date, await gather(date));
  return dayCache.get(date)!;
}

export async function submit(date: string, entries: Entry[]): Promise<SubmitResult[]> {
  const results: SubmitResult[] = [];
  for (const [i, e] of entries.entries()) {
    try {
      await ts("POST", "/time-sheets", {
        project_id: e.project_id,
        project_task_type_id: e.project_task_type_id,
        exclude: 0, // lunch is already a gap between entries
        stamp_date: `${date}T00:00:00.000Z`,
        start_date: toUtc(date, e.start),
        end_date: toUtc(date, e.end, toMin(e.end) <= toMin(e.start)),
        detail: e.detail,
        ...(e.remark ? { remark: e.remark } : {}),
        feeling: e.feeling || "NEUTRAL",
        isWorkFromHome: e.isWorkFromHome === true,
      });
      results.push({ i, ok: true });
    } catch (err: any) {
      results.push({ i, ok: false, error: err.message });
    }
  }
  return results;
}
