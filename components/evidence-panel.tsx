"use client";

import {
  ArrowRightLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileMinusIcon,
  FilePenIcon,
  FilePlusIcon,
  GitCommitHorizontalIcon,
  MessageSquareTextIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Commit, type CommitFile, type DayData, type Msg, groupBy } from "@/lib/rules";
import { cn } from "@/lib/utils";

type Toggle = (ids: string[], include: boolean) => void;

// `excluded` holds the IDs of unticked chat messages and commits; everything else is sent to the LLM.
export function EvidencePanel({
  day,
  excluded,
  onExcludedChange,
}: {
  day: DayData;
  excluded: Set<string>;
  onExcludedChange: (next: Set<string>) => void;
}) {
  const toggle: Toggle = (ids, include) => {
    const next = new Set(excluded);
    for (const id of ids) {
      if (include) next.delete(id);
      else next.add(id);
    }
    onExcludedChange(next);
  };
  const picked = (ids: string[]) => ids.filter((id) => !excluded.has(id)).length;
  const chatGroups = Object.entries(groupBy(day.chat, (m) => m.group));
  const commitGroups = Object.entries(groupBy(day.commits, (c) => c.project));

  return (
    <Tabs defaultValue="chat">
      <TabsList className="w-full">
        <TabsTrigger value="chat">
          <MessageSquareTextIcon /> LINE chat
          <Badge variant="secondary">
            {picked(day.chat.map((m) => m.id))}/{day.chat.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="commits">
          <GitCommitHorizontalIcon /> Commits
          {day.commitsError ? (
            <TriangleAlertIcon className="text-amber-500" />
          ) : (
            <Badge variant="secondary">
              {picked(day.commits.map((c) => c.id))}/{day.commits.length}
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="chat">
        <ScrollArea className="h-[480px] pr-3">
          {chatGroups.length ? (
            <div className="space-y-3">
              {chatGroups.map(([name, ms]) => (
                <Section key={name} name={name} ids={ms.map((m) => m.id)} excluded={excluded} toggle={toggle}>
                  <div className="space-y-2 p-3">
                    {ms.map((m, i) => (
                      <Bubble key={m.id} m={m} showName={ms[i - 1]?.sender !== m.sender} on={!excluded.has(m.id)} toggle={toggle} />
                    ))}
                  </div>
                </Section>
              ))}
            </div>
          ) : (
            <Empty>No messages to or from you on this day.</Empty>
          )}
        </ScrollArea>
      </TabsContent>

      <TabsContent value="commits">
        {day.commitsError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div>
              <div className="font-medium">Commits not loaded</div>
              <div className="text-muted-foreground">{day.commitsError} You can still generate from chat, or reload once connected.</div>
            </div>
          </div>
        )}
        <ScrollArea className="h-[480px] pr-3">
          {commitGroups.length ? (
            <div className="space-y-3">
              {commitGroups.map(([project, cs]) => (
                <Section key={project} name={project} ids={cs.map((c) => c.id)} excluded={excluded} toggle={toggle}>
                  <div className="space-y-0.5 p-1.5">
                    {cs.map((c) => (
                      <CommitItem key={c.id} c={c} on={!excluded.has(c.id)} toggle={toggle} />
                    ))}
                  </div>
                </Section>
              ))}
            </div>
          ) : (
            !day.commitsError && <Empty>No commits found for this day (check GITLAB_* in .env).</Empty>
          )}
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

// One LINE file or GitLab project: collapsible, with a check-all box (indeterminate when partly ticked).
function Section({
  name,
  ids,
  excluded,
  toggle,
  children,
}: {
  name: string;
  ids: string[];
  excluded: Set<string>;
  toggle: Toggle;
  children: React.ReactNode;
}) {
  const on = ids.filter((id) => !excluded.has(id)).length;
  return (
    <Collapsible defaultOpen className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2.5 bg-muted/50 px-3 py-2">
        <Checkbox
          aria-label={`Include all of ${name}`}
          checked={on === ids.length}
          indeterminate={on > 0 && on < ids.length}
          onCheckedChange={(c) => toggle(ids, c)}
        />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-semibold">
          <span className="truncate">{name}</span>
          <span className="ml-auto shrink-0 font-normal tabular-nums text-muted-foreground">
            {on}/{ids.length}
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="border-t">{children}</CollapsibleContent>
    </Collapsible>
  );
}

// Stable per-sender name colour, like a group chat.
const NAME_COLORS = [
  "text-rose-600 dark:text-rose-400",
  "text-amber-600 dark:text-amber-400",
  "text-emerald-600 dark:text-emerald-400",
  "text-sky-600 dark:text-sky-400",
  "text-violet-600 dark:text-violet-400",
  "text-pink-600 dark:text-pink-400",
  "text-teal-600 dark:text-teal-400",
  "text-orange-600 dark:text-orange-400",
];
const nameColor = (s: string) => NAME_COLORS[[...s].reduce((h, ch) => (h * 31 + ch.codePointAt(0)!) >>> 0, 7) % NAME_COLORS.length];

// Bold @mentions ("@kiratae", "@All") inside a message.
const withMentions = (text: string) => text.split(/(@\S+)/).map((part, i) => (part.startsWith("@") ? <b key={i}>{part}</b> : part));

function Bubble({ m, showName, on, toggle }: { m: Msg; showName: boolean; on: boolean; toggle: Toggle }) {
  return (
    <label className={cn("flex cursor-pointer items-end gap-2", m.mine && "flex-row-reverse", !on && "opacity-45")}>
      <Checkbox className="mb-5 shrink-0" aria-label="Include message" checked={on} onCheckedChange={(c) => toggle([m.id], c)} />
      <div className={cn("flex max-w-[85%] min-w-0 flex-col", m.mine ? "items-end" : "items-start")}>
        {showName && !m.mine && <span className={cn("mb-0.5 px-1 text-[11px] font-semibold", nameColor(m.sender))}>{m.sender}</span>}
        <div
          className={cn(
            "rounded-2xl px-3 py-1.5 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-xs",
            m.mine ? "rounded-br-md bg-blue-500 text-white" : "rounded-bl-md bg-muted",
          )}
        >
          {withMentions(m.body || m.text)}
        </div>
        <span className="mt-0.5 px-1 text-[10px] tabular-nums text-muted-foreground">{m.time}</span>
      </div>
    </label>
  );
}

function CommitItem({ c, on, toggle }: { c: Commit; on: boolean; toggle: Toggle }) {
  const body = c.message.slice(c.title.length).trim();
  return (
    <Collapsible className={cn("rounded-md", !on && "opacity-50")}>
      <div className="flex items-center gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-muted/60">
        <Checkbox aria-label="Include commit" checked={on} onCheckedChange={(v) => toggle([c.id], v)} />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
          <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{c.time}</span>
          <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
          <Stat add={c.additions} del={c.deletions} />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <div className="mb-2 ml-[2.1rem] space-y-2 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1 py-0.5 font-mono">{c.id.slice(0, 8)}</code>
            <span>
              {c.files.length} file{c.files.length === 1 ? "" : "s"}
            </span>
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                Open in GitLab <ExternalLinkIcon className="size-3" />
              </a>
            )}
          </div>
          {body && <p className="text-xs whitespace-pre-wrap text-muted-foreground">{body}</p>}
          <ul className="space-y-0.5">
            {c.files.map((f) => (
              <FileRow key={f.path} f={f} />
            ))}
          </ul>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

const FILE_ICON = {
  added: <FilePlusIcon className="size-3.5 shrink-0 text-emerald-500" />,
  deleted: <FileMinusIcon className="size-3.5 shrink-0 text-red-500" />,
  renamed: <ArrowRightLeftIcon className="size-3.5 shrink-0 text-sky-500" />,
  modified: <FilePenIcon className="size-3.5 shrink-0 text-amber-500" />,
};

function FileRow({ f }: { f: CommitFile }) {
  const slash = f.path.lastIndexOf("/");
  return (
    <li className="flex items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/60" title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
      {FILE_ICON[f.status]}
      <span className="min-w-0 flex-1 truncate font-mono">
        <span className="text-muted-foreground">{f.path.slice(0, slash + 1)}</span>
        {f.path.slice(slash + 1)}
      </span>
      <Stat add={f.additions} del={f.deletions} />
    </li>
  );
}

function Stat({ add, del }: { add: number; del: number }) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums">
      <span className="text-emerald-600 dark:text-emerald-400">+{add}</span> <span className="text-red-600 dark:text-red-400">−{del}</span>
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
