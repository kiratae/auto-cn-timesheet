import { errorJson, guard } from "@/lib/guard";
import { gatherCached, localDate } from "@/lib/timesheet";

export async function GET(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const date = new URL(req.url).searchParams.get("date") || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorJson("date must be YYYY-MM-DD", 400);
  try {
    return Response.json(await gatherCached(date, true));
  } catch (e) {
    return errorJson(e);
  }
}
