// The app holds your API keys server-side and binds to 127.0.0.1, but any website you visit could still
// send requests to it. Block DNS-rebinding reads (wrong Host) and cross-site form POSTs: a JSON content
// type forces a CORS preflight, which we never answer.
export function guard(req: Request): Response | undefined {
  const host = (req.headers.get("host") || "").replace(/:\d+$/, "");
  if (host !== "127.0.0.1" && host !== "localhost") return new Response("Forbidden", { status: 403 });
  if (req.method === "POST" && !req.headers.get("content-type")?.startsWith("application/json"))
    return new Response("Unsupported Media Type", { status: 415 });
}

export const errorJson = (e: unknown, status = 500) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
