import { errorJson, guard } from "@/lib/guard";
import { saveLineChats } from "@/lib/timesheet";

// Save the LINE chat names to export (the header config popover).
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  try {
    const { chats } = await req.json();
    if (!Array.isArray(chats)) return errorJson("chats must be an array", 400);
    return Response.json({ chats: saveLineChats(chats) });
  } catch (e) {
    return errorJson(e);
  }
}
