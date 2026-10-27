"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fetchMonth } from "@/lib/api";
import { type DayStatus, dayStatus } from "@/lib/rules";

// A dot under each day: how much of it is already logged on the timesheet (see dayStatus).
const DOT = "relative after:absolute after:bottom-0.5 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full";
const DOTS: Record<DayStatus, string> = {
  full: `${DOT} after:bg-emerald-500`,
  over: `${DOT} after:bg-sky-500`,
  under: `${DOT} after:bg-amber-400`,
  missing: `${DOT} after:bg-red-500`,
  pending: `${DOT} after:bg-muted-foreground/40`,
};
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

// Date picker from github.com/flixlix/shadcn-date-picker (components/ui/calendar.tsx: click the month
// title to jump between years), wired to this project's Base UI popover. Value is "YYYY-MM-DD".
export function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const [month, setMonth] = useState(selected);
  const [mins, setMins] = useState<Record<string, number>>({}); // empty until loaded, so no dots flash red
  const load = (m: Date) => {
    setMonth(m);
    fetchMonth(format(m, "yyyy-MM"))
      .then((r) => setMins((prev) => ({ ...prev, ...r })))
      .catch(() => {}); // dots are a nicety; the picker works without them
  };
  const openChange = (o: boolean) => {
    setOpen(o);
    if (o) load(selected); // re-fetch each open, so entries submitted since then show up
  };
  const pick = (d: Date | undefined) => {
    if (!d) return;
    onChange(ymd(d));
    setOpen(false);
  };
  const today = ymd(new Date());
  const modifiers = Object.fromEntries(
    (Object.keys(DOTS) as DayStatus[]).map((s) => [s, (d: Date) => ymd(d) in mins && dayStatus(ymd(d), mins[ymd(d)], today) === s]),
  );
  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger render={<Button variant="outline" aria-label="Date" className="w-[11.5rem] justify-start font-normal" />}>
        <CalendarIcon className="text-muted-foreground" />
        {/* date-fns formats without Intl, so server and browser render the same text (no hydration mismatch). */}
        {format(selected, "EEE, d MMM yyyy")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={load}
          modifiers={modifiers}
          modifiersClassNames={DOTS}
          onSelect={pick}
          autoFocus
        />
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => pick(new Date())}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
