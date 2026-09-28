"use client";

import { useState } from "react";
import { ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerOption = { value: string; label: string; hint?: string };

// Searchable dropdown: there can be up to ~950 task types, too many for a plain <select>.
export function OptionPicker({
  value,
  options,
  placeholder,
  onChange,
  invalid,
  disabled,
}: {
  value: string;
  options: PickerOption[];
  placeholder: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={<Button variant="outline" aria-invalid={invalid || undefined} className="h-auto min-h-8 w-full min-w-0 justify-between py-1.5 text-left font-normal whitespace-normal" />}
      >
        <span title={selected?.label} className={cn("line-clamp-2 break-words", !selected && "text-muted-foreground")}>{selected?.label ?? placeholder}</span>
        <ChevronsUpDownIcon className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label} ${o.hint ?? ""}`}
                  data-checked={o.value === value}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <div className="min-w-0">
                    <div className="break-words">{o.label}</div>
                    {o.hint && <div className="break-words text-xs text-muted-foreground">{o.hint}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
