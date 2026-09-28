import { guard } from "@/lib/guard";
import { requestCancel } from "@/lib/line-export";

// Cancel a LINE export during its countdown. "too-late" once it has taken control of the mouse.
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  return Response.json({ status: requestCancel() });
}
