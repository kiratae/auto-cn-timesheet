/* eslint-disable @typescript-eslint/no-explicit-any -- tests pass deliberately malformed entries */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forRole, freeSlots, toMin, validateEntries } from "./rules";
import { filterChat, parseLine, writingNow } from "./timesheet";

const dir = join(import.meta.dir, "..", process.env.LINE_DIR || ".");
// Real chat export (gitignored personal data): these tests skip on a clone without it.
const file = join(dir, "[LINE]OIC-IBSL_ทีมงาน.txt");
const hasChat = existsSync(file);
const msgs = hasChat ? parseLine(readFileSync(file, "utf8"), "OIC-IBSL_ทีมงาน", "kiratae") : [];
const pats = ["kiratae", "เต้(?![นา])", "@All"].map((p) => new RegExp(p, "i"));

test.skipIf(!hasChat)("2026-09-28: multi-line deploy request and my reply", () => {
  const f = filterChat(msgs, "2026-09-28", pats);
  expect(f.some((m) => m.text.includes("Deploy 2 เรื่อง") && m.text.includes("claim_payment_type"))).toBe(true);
  expect(f.some((m) => m.mine && m.text.includes("23:00-01:00"))).toBe(true);
});

test.skipIf(!hasChat)("2026-09-24: inactive-claims request and reply, no noise", () => {
  const f = filterChat(msgs, "2026-09-24", pats);
  expect(f.some((m) => m.text.includes("ตรวจสอบรายการเคลม"))).toBe(true);
  expect(f.some((m) => m.mine && m.text.includes("Inactive รายการเหล่านี้") && m.text.includes("RG2501-82220"))).toBe(true);
  expect(f.some((m) => m.text.endsWith(" Photos"))).toBe(false);
  expect(f.every((m) => m.date === "2026-09-24")).toBe(true);
});

const slots = freeSlots([toMin("09:00"), toMin("18:00")], [
  [toMin("12:00"), toMin("13:00")],
  [toMin("14:00"), toMin("15:30")],
]);

test("freeSlots subtracts lunch and existing entries", () => {
  expect(slots).toEqual([
    [540, 720],
    [780, 840],
    [930, 1080],
  ]);
});

// Same busy set, but open all day and into the next morning (what validation allows).
// An existing late-evening entry 20:00-21:00 is busy too.
const open = freeSlots([0, 2880], [
  [toMin("12:00"), toMin("13:00")],
  [toMin("14:00"), toMin("15:30")],
  [toMin("20:00"), toMin("21:00")],
]);

test("validateEntries", () => {
  const opt = [{ project_id: "p", project_name: "P", task_type_id: "t", task_type_name: "T", group: "Developer" }];
  const e = (start: string, end: string, extra = {}) => ({ start, end, project_id: "p", project_task_type_id: "t", detail: "งาน", ...extra });
  expect(validateEntries([e("09:00", "12:00"), e("13:00", "14:00")], open, opt)).toEqual([]);
  const msgsOf = (xs: any[]) => validateEntries(xs, open, opt).map((x) => x.msg);
  expect(msgsOf([e("09:00", "11:00"), e("10:00", "12:00")])).toContain("overlaps entry #1");
  expect(msgsOf([e("11:00", "13:30")])).toContain("overlaps lunch or an existing entry");
  expect(msgsOf([e("09:00", "10:00", { project_task_type_id: "x" })])).toContain("unknown project/task type");
  expect(msgsOf([e("09:00", "10:00", { detail: "<b>x</b>" })])).toContain("detail must not contain HTML");
  expect(msgsOf([e("09:00", "10:00", { isWorkFromHome: "yes" })])).toContain("isWorkFromHome must be true/false");
});

test("night deploys outside work hours", () => {
  const opt = [{ project_id: "p", project_name: "P", task_type_id: "t", task_type_name: "T", group: "Developer" }];
  const e = (start: string, end: string) => ({ start, end, project_id: "p", project_task_type_id: "t", detail: "deploy" });
  const msgsOf = (xs: any[]) => validateEntries(xs, open, opt).map((x) => x.msg);
  expect(msgsOf([e("23:00", "01:00")])).toEqual([]); // crosses midnight
  expect(msgsOf([e("06:00", "08:00")])).toEqual([]); // early morning, same day
  expect(msgsOf([e("19:30", "20:30")])).toContain("overlaps lunch or an existing entry");
  expect(msgsOf([e("17:00", "09:00")])).toContain("longer than 12h (end before start means next day)");
  expect(msgsOf([e("22:00", "00:30"), e("23:00", "01:00")])).toContain("overlaps entry #1");
  // An entry starting after midnight belongs to the early morning of this date, not after tonight's deploy.
  expect(msgsOf([e("23:00", "01:00"), e("00:30", "02:00")])).toEqual([]);
});

test("forRole sends only that role's task types; no role sends everything", () => {
  const o = (project_id: string, group: string, task_type_id: string) =>
    ({ project_id, project_name: project_id, task_type_id, task_type_name: `${group} / x`, group });
  const opts = [o("ibsl", "Developer", "d1"), o("ibsl", "Devops", "o1"), o("leave", "Leave", "l1")];
  expect(forRole(opts, "Developer").map((x) => x.task_type_id)).toEqual(["d1"]);
  expect(forRole(opts, "")).toEqual(opts);
});

test("parseLine splits multi-word sender names from the message", () => {
  const day = msgs.filter((m) => m.date === "2026-09-24");
  const bank = day.find((m) => m.text.includes("จะปรับเลยไม่ได้นะครับ"))!;
  expect(bank.sender).toBe("พี่แบงค์ PM [CN]");
  expect(bank.body).toBe("จะปรับเลยไม่ได้นะครับ");
  const mine = day.find((m) => m.text.startsWith("kiratae Inactive"))!;
  expect([mine.sender, mine.mine]).toEqual(["kiratae", true]);
  expect(mine.body.startsWith("Inactive รายการเหล่านี้")).toBe(true);
});

test("writingNow reads the entry being streamed from partial JSON", () => {
  const out = String.raw`{"entries":[{"start":"09:00","end":"12:00","detail":"a"},{"start":"13:00","end":"15:30","detail":"แก้บั๊ก \"login\"\nหน้า`;
  expect(writingNow(out)).toEqual({ text: "LLM writing entry 2 (13:00-15:30)", detail: `แก้บั๊ก "login" หน้า` });
});
