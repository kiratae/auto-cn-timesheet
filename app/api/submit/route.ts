import { errorJson, guard } from "@/lib/guard";
import { type Entry, validateEntries } from "@/lib/rules";
import { dayState, getOptions, submit } from "@/lib/timesheet";

export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    const { date, entries } = (await req.json()) as { date: string; entries: Entry[] };
    // Re-check against fresh data: someone may have added entries in the timesheet site since the page loaded.
    const [state, options] = await Promise.all([dayState(date), getOptions()]);
    const errors = validateEntries(entries, state.open, options);
    if (errors.length) return Response.json({ errors }, { status: 400 });
    return Response.json({ results: await submit(date, entries) });
  } catch (e) {
    return errorJson(e);
  }
}
