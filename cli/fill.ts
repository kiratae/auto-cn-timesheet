// CLI: bun run cli [--date YYYY-MM-DD] [--role Developer] [--yes]
// Gathers the day's evidence, asks the LLM (+ Jev) for entries, shows a preview, and posts on "y".
// The web UI is the Next.js app: `bun run dev`.
import { type Entry, toHM } from "../lib/rules";
import { JEV_MIN, gather, localDate, propose, since, submit } from "../lib/timesheet";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : undefined;
};
const date = arg("--date") ?? localDate();
const role = arg("--role") ?? process.env.ROLE ?? "";
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad --date ${date}, expected YYYY-MM-DD`);

const day = await gather(date);
console.log(`${date}: ${day.chat.length} chat messages, ${day.commits.length} commits, ${day.existing.length} existing entries`);
if (day.commitsError) console.warn(`⚠ ${day.commitsError} Continuing with chat only.`);
console.log("Free work hours:", day.slots.map(([a, b]) => `${toHM(a)}-${toHM(b)}`).join(", ") || "none (only after-hours work can be added)");
if (role && !day.roles.includes(role)) throw new Error(`Unknown role "${role}". Roles: ${day.roles.join(", ")}`);

const t0 = Date.now();
const { entries, errors } = await propose(day, day.chat, day.commits, role, (e) => e.live || console.log(`[+${since(t0)}] ${e.text}${e.detail ? `\n${e.detail}` : ""}`));
const label = (e: Entry) => day.options.find((o) => o.task_type_id === e.project_task_type_id && o.project_id === e.project_id);
console.table(
  entries.map((e) => ({
    time: `${e.start}-${e.end}${e.end <= e.start ? " (+1d)" : ""}`,
    task: label(e) ? `${label(e)!.project_name} / ${label(e)!.task_type_name}` : "?",
    wfh: e.isWorkFromHome ? "yes" : "",
    ...(e.confidence !== undefined && { jev: `${Math.round(e.confidence * 100)}%${e.confidence < JEV_MIN ? " ⚠" : ""}` }),
    detail: e.detail.replace(/\s+/g, " ").slice(0, 70),
  })),
);
if (entries.some((e) => e.confidence !== undefined && e.confidence < JEV_MIN))
  console.warn(`⚠ Jev is unsure about some project/task picks (< ${JEV_MIN * 100}%). Check them, or fix them in the web UI (bun run dev).`);
if (errors.length) {
  for (const e of errors) console.error(`entry ${e.i + 1}: ${e.msg}`);
  console.error("LLM output still invalid; nothing submitted. Fix it by hand in the web UI (bun run dev).");
  process.exit(1);
}
if (!args.includes("--yes") && prompt("Submit these entries? [y/N]")?.trim().toLowerCase() !== "y") {
  console.log("Cancelled.");
} else {
  for (const r of await submit(date, entries)) console.log(r.ok ? `✓ entry ${r.i + 1}` : `✗ entry ${r.i + 1}: ${r.error}`);
}
