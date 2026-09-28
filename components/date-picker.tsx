"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Date picker from github.com/flixlix/shadcn-date-picker (components/ui/calendar.tsx: click the month
// title to jump between years), wired to this project's Base UI popover. Value is "YYYY-MM-DD".
export function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseISO(value);
  const pick = (d: Date | undefined) => {
    if (!d) return;
    onChange(format(d, "yyyy-MM-dd"));
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" aria-label="Date" className="w-[11.5rem] justify-start font-normal" />}>
        <CalendarIcon className="text-muted-foreground" />
        {/* date-fns formats without Intl, so server and browser render the same text (no hydration mismatch). */}
        {format(selected, "EEE, d MMM yyyy")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar mode="single" required selected={selected} defaultMonth={selected} onSelect={pick} autoFocus />
        <div className="border-t p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => pick(new Date())}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
