import { errorJson, guard } from "@/lib/guard";
import { monthMinutes } from "@/lib/timesheet";

export async function GET(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const month = new URL(req.url).searchParams.get("month") || "";
  if (!/^\d{4}-\d{2}$/.test(month)) return errorJson("month must be YYYY-MM", 400);
  try {
    return Response.json(await monthMinutes(month));
  } catch (e) {
    return errorJson(e);
  }
}
