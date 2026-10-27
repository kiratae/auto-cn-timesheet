// Browser-side calls to the route handlers in app/api/*.
import type { ChatExport, DayData, Entry, EntryError, SubmitResult } from "./rules";

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({ error: r.statusText }));
  if (!r.ok && !j.errors) throw new Error(j.error || r.statusText);
  return j as T;
}

export const fetchDay = async (date: string) => json<DayData>(await fetch(`/api/day?date=${date}`));

export type ProposeBody = { date: string; chatIds: string[]; commitIds: string[]; role: string };

// Long-running routes (/api/propose, /api/line-export) stream newline-delimited JSON:
// {progress} lines while they work, then one {result} or {error}.
export type OnProgress = (text: string, extra?: { detail?: string; live?: boolean }) => void;

async function streamNdjson<T>(path: string, body: unknown, onProgress: OnProgress): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    let msg = text || r.statusText;
    try {
      msg = JSON.parse(text).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let result: T | undefined;
  let error: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.progress) onProgress(msg.progress, { detail: msg.detail, live: msg.live });
      else if (msg.result) result = msg.result;
      else if (msg.error) error = msg.error;
    }
  }
  if (error) throw new Error(error);
  if (!result) throw new Error("The connection closed before a result arrived");
  return result;
}

export const proposeStream = (body: ProposeBody, onProgress: OnProgress) =>
  streamNdjson<{ entries: Entry[]; errors: EntryError[] }>("/api/propose", body, onProgress);

export const exportLineStream = (onProgress: (text: string) => void) =>
  streamNdjson<{ chats: ChatExport[]; cancelled: boolean }>("/api/line-export", {}, onProgress);

// Only honoured during the export's countdown; "too-late" once it has taken control of the mouse.
export async function cancelLineExport() {
  const r = await fetch("/api/line-export/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  return json<{ status: "requested" | "too-late" | "not-running" }>(r);
}

export async function submitEntries(date: string, entries: Entry[]) {
  const r = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, entries }) });
  return json<{ results?: SubmitResult[]; errors?: EntryError[] }>(r);
}
