import { guard } from "@/lib/guard";
import { exportChats, isExportRunning } from "@/lib/line-export";

// Streams NDJSON like /api/propose: {progress} lines while LINE is driven, then {result:{chats}} or {error}.
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  if (isExportRunning()) return Response.json({ error: "A LINE export is already running" }, { status: 409 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (x: unknown) => controller.enqueue(enc.encode(JSON.stringify(x) + "\n"));
      const heartbeat = setInterval(() => send({ progress: "…still working" }), 20_000);
      try {
        send({ result: await exportChats((text) => send({ progress: text })) });
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
