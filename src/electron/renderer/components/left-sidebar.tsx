import { useEffect, useRef, useState } from "react";
import { useLocalStorage } from "usehooks-ts";
import type { ProjectMeta, SessionMeta } from "@core/types";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ChevronRight, Folder, MoreHorizontal, PlusIcon } from "lucide-react";
import { SectionLabel } from "@/components/ui/section-label";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";

type LeftSidebarProps = {
  rollingKeyPoints: string[];
  sessions: SessionMeta[];
  activeSessionId?: string | null;
  onNewSession?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  projects: ProjectMeta[];
  activeProjectId: string | null;
  onSelectProject: (id: string | null) => void;
  onCreateProject: (name: string, instructions: string, context: string) => void;
  onEditProject: (project: ProjectMeta) => void;
  onDeleteProject: (id: string) => void;
  onMoveSessionToProject?: (sessionId: string, projectId: string | null) => void;
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function normalizeListText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/g, "")
    .toLowerCase();
}

type ProjectFormMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; project: ProjectMeta };

type LeftRailMode = "briefing" | "sessions";

function RailModeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-7 rounded-sm text-xs transition-colors cursor-pointer",
        active
          ? "bg-background text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/70",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export function LeftSidebar({
  rollingKeyPoints,
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onEditProject,
  onDeleteProject,
  onMoveSessionToProject,
}: LeftSidebarProps) {
  const [formMode, setFormMode] = useState<ProjectFormMode>({ kind: "none" });
  const [mode, setMode] = useLocalStorage<LeftRailMode>("ambient-left-rail-mode", "sessions");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formContext, setFormContext] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (formMode.kind !== "none") {
      nameInputRef.current?.focus();
    }
  }, [formMode.kind]);

  useEffect(() => {
    if (formMode.kind !== "none") {
      setFormMode({ kind: "none" });
    }
  }, [activeProjectId]);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
  const liveSummaryPoints = (() => {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const raw of rollingKeyPoints) {
      const text = raw.trim().replace(/\s+/g, " ");
      if (!text) continue;
      const key = normalizeListText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(text);
    }
    return [...unique].reverse();
  })();

  function openCreateForm() {
    setFormName("");
    setFormInstructions("");
    setFormContext("");
    setFormMode({ kind: "create" });
  }

  function openEditForm(project: ProjectMeta) {
    setFormName(project.name);
    setFormInstructions(project.instructions ?? "");
    setFormContext(project.context ?? "");
    setFormMode({ kind: "edit", project });
  }

  function cancelForm() {
    setFormMode({ kind: "none" });
  }

  function submitForm() {
    const name = formName.trim();
    const instructions = formInstructions.trim();
    const context = formContext.trim();
    if (!name) return;
    if (formMode.kind === "create") {
      onCreateProject(name, instructions, context);
    } else if (formMode.kind === "edit") {
      onEditProject({ ...formMode.project, name, instructions, context });
    }
    setFormMode({ kind: "none" });
  }

  return (
    <div className="w-full h-full shrink-0 border-r border-border flex flex-col min-h-0 bg-sidebar">
      {/* Project selector */}
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <div className="flex items-center gap-1">
          <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-between h-7 px-2 text-xs font-medium text-left truncate"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{activeProject ? activeProject.name : "All Sessions"}</span>
                </span>
                <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${projectMenuOpen ? "rotate-90" : ""}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuItem onSelect={() => onSelectProject(null)}>
                <span className="flex flex-1 items-center">
                  <span className="flex-1">All Sessions</span>
                  {!activeProject && <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4 text-muted-foreground" />}
                </span>
              </DropdownMenuItem>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => onSelectProject(p.id)}>
                  <span className="flex flex-1 items-center">
                    <span className="flex-1 truncate">{p.name}</span>
                    {activeProjectId === p.id && (
                      <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="mx-2" />
              <DropdownMenuItem onSelect={openCreateForm}>
                <span className="flex items-center gap-1.5">
                  <PlusIcon className="size-3.5 shrink-0" />
                  <span>New Folder…</span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {activeProject && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Edit folder"
              onClick={() => openEditForm(activeProject)}
            >
              ✎
            </Button>
          )}
        </div>

        {/* Inline project form */}
        {formMode.kind !== "none" && (
          <div className="mt-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Folder name
              </label>
              <Input
                ref={nameInputRef}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Name this folder"
                className="h-7 bg-background text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitForm();
                  if (e.key === "Escape") cancelForm();
                }}
              />
            </div>
            <div className="mt-1.5 space-y-1">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Agent instructions
              </label>
              <textarea
                value={formInstructions}
                onChange={(e) => setFormInstructions(e.target.value)}
                placeholder="Additional instructions for agents on how to behave (optional)"
                rows={3}
                className="w-full resize-none rounded-sm border border-input bg-background px-2 py-1.5 text-xs leading-5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelForm();
                }}
              />
            </div>
            <div className="mt-1.5 space-y-1">
              <label className="block text-[11px] font-medium text-muted-foreground">
                Transcription context
              </label>
              <textarea
                value={formContext}
                onChange={(e) => setFormContext(e.target.value)}
                placeholder="Additional speech context, like names, glossary terms, or jargon (optional)"
                rows={3}
                className="w-full resize-none rounded-sm border border-input bg-background px-2 py-1.5 text-xs leading-5 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                onKeyDown={(e) => {
                  if (e.key === "Escape") cancelForm();
                }}
              />
            </div>
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" className="h-6 text-xs px-2" onClick={submitForm} disabled={!formName.trim()}>
                {formMode.kind === "create" ? "Create" : "Save"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={cancelForm}>
                Cancel
              </Button>
              {formMode.kind === "edit" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs px-2 ml-auto text-destructive hover:text-destructive"
                  onClick={() => { onDeleteProject(formMode.project.id); cancelForm(); }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <Separator className="mx-auto !w-[calc(100%-1rem)]" />

      <div className="px-3 pt-3 pb-2 shrink-0">
        <Button
          size="sm"
          className="w-full justify-center hover:bg-primary/90"
          onClick={onNewSession}
        >
          <PlusIcon className="size-3.5" data-icon="inline-start" />
          New Session
        </Button>
      </div>

      <div className="px-2 py-2 shrink-0">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-foreground/[0.045] p-1 dark:bg-muted/50">
          <RailModeButton
            label={`Sessions (${sessions.length})`}
            active={mode === "sessions"}
            onClick={() => setMode("sessions")}
          />
          <RailModeButton
            label="Briefing"
            active={mode === "briefing"}
            onClick={() => setMode("briefing")}
          />
        </div>
      </div>

      <div className="px-3 py-2.5 flex-1 min-h-0 flex flex-col">
        {mode === "briefing" ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <section className="min-h-0 flex-1 flex flex-col">
              <SectionLabel className="mb-2">Live Summary</SectionLabel>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {liveSummaryPoints.length > 0 ? (
                  <ul className="space-y-1.5">
                    {liveSummaryPoints.map((point, i) => (
                      <li key={`${point}-${i}`} className="text-xs text-foreground leading-relaxed">
                        <span className="text-muted-foreground mr-1">•</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    Summary will appear during recording...
                  </p>
                )}
              </div>
            </section>
          </div>
        ) : (
          <>
            <SectionLabel className="mb-2 shrink-0">Sessions</SectionLabel>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {sessions.length > 0 ? (
                <ul className="space-y-1">
                  {sessions.map((session) => (
                    <li key={session.id} className="group">
                      <div
                        className={`rounded-sm text-xs transition-colors flex items-start gap-1 ${activeSessionId === session.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectSession?.(session.id)}
                          className="flex-1 min-w-0 text-left px-2 py-1.5 cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-foreground font-medium truncate">
                              {session.title ?? "Untitled Session"}
                            </span>
                          </div>
                          <div className="text-muted-foreground text-2xs font-mono">
                            {formatDate(session.startedAt)} · {formatTime(session.startedAt)}
                            {session.agentCount > 0 && ` · ${session.agentCount} agent${session.agentCount !== 1 ? "s" : ""}`}
                          </div>
                        </button>
                        {(onDeleteSession || onMoveSessionToProject) && (
                          <div className="pt-1 pr-1 shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                  aria-label="Session actions"
                                >
                                  <MoreHorizontal className="size-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                {onMoveSessionToProject && projects.length > 0 && (
                                  <>
                                    <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                                    {projects.map((project) => (
                                      <DropdownMenuItem
                                        key={project.id}
                                        onSelect={() => onMoveSessionToProject(
                                          session.id,
                                          session.projectId === project.id ? null : project.id,
                                        )}
                                      >
                                        <span className="flex flex-1 items-center">
                                          <span className="flex-1 truncate">{project.name}</span>
                                          {session.projectId === project.id && (
                                            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
                                          )}
                                        </span>
                                      </DropdownMenuItem>
                                    ))}
                                  </>
                                )}
                                {onDeleteSession && (
                                  <>
                                    {onMoveSessionToProject && projects.length > 0 && <DropdownMenuSeparator className="mx-2" />}
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => onDeleteSession(session.id)}
                                    >
                                      Delete session
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No previous sessions
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
