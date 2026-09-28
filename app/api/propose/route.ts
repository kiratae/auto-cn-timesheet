import { guard } from "@/lib/guard";
import { gatherCached, propose } from "@/lib/timesheet";

// Streamed as newline-delimited JSON so the page can show progress while the LLM/Jev calls are in flight
// (this can take minutes): one {progress} line per step, then one {result} or {error} line at the end.
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const { date, chatIds = [], commitIds = [], role = "" } = (await req.json()) as {
    date: string;
    chatIds?: string[];
    commitIds?: string[];
    role?: string;
  };
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => controller.enqueue(enc.encode(JSON.stringify(x) + "\n"));
      // A slow LLM can go minutes between progress lines; a heartbeat keeps the connection from idling out.
      const heartbeat = setInterval(() => send({ progress: "…still waiting" }), 20_000);
      try {
        const day = await gatherCached(date);
        const result = await propose(
          day,
          day.chat.filter((m) => chatIds.includes(m.id)),
          day.commits.filter((c) => commitIds.includes(c.id)),
          role,
          (e) => send({ progress: e.text, detail: e.detail, live: e.live }),
        );
        send({ result });
      } catch (e) {
        send({ error: e instanceof Error ? e.message : String(e) });
      }
      clearInterval(heartbeat);
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
