import { connection } from "next/server";
import { TimesheetApp } from "@/components/timesheet-app";
import { appConfig, localDate } from "@/lib/timesheet";

export default async function Page() {
  await connection(); // render per request, so "today" (in TZ_OFFSET) is never a stale build-time date
  return <TimesheetApp initialDate={localDate()} config={appConfig()} />;
}
