import { useEffect, useRef, useState } from "react";
import type { Agent, ProjectMeta, SessionMeta } from "@core/types";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageCircleIcon,
  MoreHorizontal,
  PlusIcon,
} from "lucide-react";
import { SectionLabel } from "@/components/ui/section-label";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon, WorkoutRunIcon } from "@hugeicons/core-free-icons";

type LeftSidebarProps = {
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
  agentsBySessionId?: Record<string, Agent[]>;
  selectedAgentId?: string | null;
  onSelectAgent?: (sessionId: string, agentId: string) => void;
  collapsed?: boolean;
};

type ProjectFormMode =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "edit"; project: ProjectMeta };

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

export function LeftSidebar({
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
  agentsBySessionId = {},
  selectedAgentId,
  onSelectAgent,
  collapsed = false,
}: LeftSidebarProps) {
  const [formMode, setFormMode] = useState<ProjectFormMode>({ kind: "none" });
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formInstructions, setFormInstructions] = useState("");
  const [formContext, setFormContext] = useState("");
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(new Set());
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (formMode.kind !== "none") nameInputRef.current?.focus();
  }, [formMode.kind]);

  useEffect(() => {
    if (formMode.kind !== "none") setFormMode({ kind: "none" });
  }, [activeProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeSessionId) return;
    setExpandedSessionIds((prev) => {
      if (prev.has(activeSessionId)) return prev;
      const next = new Set(prev);
      next.add(activeSessionId);
      return next;
    });
  }, [activeSessionId]);

  const activeProject = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;

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
    if (!name) return;
    const instructions = formInstructions.trim();
    const context = formContext.trim();
    if (formMode.kind === "create") {
      onCreateProject(name, instructions, context);
    } else if (formMode.kind === "edit") {
      onEditProject({ ...formMode.project, name, instructions, context });
    }
    setFormMode({ kind: "none" });
  }

  function toggleSessionExpanded(sessionId: string) {
    setExpandedSessionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  const projectMenu = (
    <DropdownMenu open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <button
            type="button"
            className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            aria-label={activeProject ? activeProject.name : "All Sessions"}
            title={activeProject ? activeProject.name : "All Sessions"}
          >
            <Folder className="size-4" />
          </button>
        ) : (
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
        )}
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
            <span>New Folder...</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (collapsed) {
    return (
      <div className="w-full h-full shrink-0 border-r border-border flex flex-col items-center gap-2 bg-sidebar px-1.5 py-2">
        {projectMenu}
        <button
          type="button"
          onClick={onNewSession}
          className="flex size-8 cursor-pointer items-center justify-center rounded-sm bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
          aria-label="New session"
          title="New session"
        >
          <PlusIcon className="size-4" />
        </button>
        <Separator className="!w-6" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              aria-label="Sessions"
              title="Sessions"
            >
              <MessageCircleIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[420px] w-72 overflow-y-auto">
            <DropdownMenuLabel>Sessions</DropdownMenuLabel>
            {sessions.length > 0 ? (
              sessions.map((session) => {
                const sessionAgents = agentsBySessionId[session.id] ?? [];
                const isActiveSession = activeSessionId === session.id;
                const sessionLabel = (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{session.title ?? "Untitled Session"}</span>
                    <span className="block truncate font-mono text-2xs text-muted-foreground">
                      {formatDate(session.startedAt)} · {formatTime(session.startedAt)}
                      {session.agentCount > 0 && ` · ${session.agentCount} agent${session.agentCount !== 1 ? "s" : ""}`}
                    </span>
                  </span>
                );

                if (sessionAgents.length > 0) {
                  return (
                    <DropdownMenuSub key={session.id}>
                      <DropdownMenuSubTrigger
                        className={isActiveSession ? "bg-sidebar-accent" : undefined}
                        onClick={() => onSelectSession?.(session.id)}
                      >
                        {sessionLabel}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-64">
                        {sessionAgents.map((agent) => (
                          <DropdownMenuItem
                            key={agent.id}
                            onSelect={() => onSelectAgent?.(session.id, agent.id)}
                            className={selectedAgentId === agent.id && isActiveSession ? "bg-sidebar-accent" : undefined}
                          >
                            <HugeiconsIcon icon={WorkoutRunIcon} className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1 truncate text-2xs">{agent.task}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                }

                return (
                  <DropdownMenuItem
                    key={session.id}
                    onSelect={() => onSelectSession?.(session.id)}
                    className={isActiveSession && !selectedAgentId ? "bg-sidebar-accent" : undefined}
                  >
                    {sessionLabel}
                  </DropdownMenuItem>
                );
              })
            ) : (
              <DropdownMenuItem disabled>No previous sessions</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="w-full h-full shrink-0 border-r border-border flex flex-col min-h-0 bg-sidebar">
      <div className="px-3 pt-2.5 pb-2 shrink-0">
        <div className="flex items-center gap-1">
          {projectMenu}
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

        {formMode.kind !== "none" && (
          <div className="mt-2">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-muted-foreground">Folder name</label>
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
              <label className="block text-[11px] font-medium text-muted-foreground">Agent instructions</label>
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
              <label className="block text-[11px] font-medium text-muted-foreground">Transcription context</label>
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
        <Button size="sm" className="w-full justify-center hover:bg-primary/90" onClick={onNewSession}>
          <PlusIcon className="size-3.5" data-icon="inline-start" />
          New Session
        </Button>
      </div>

      <div className="px-3 pt-2 pb-2.5 flex-1 min-h-0 flex flex-col">
        <SectionLabel className="mb-2 shrink-0">Sessions</SectionLabel>
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pb-3 scroll-pb-3">
          {sessions.length > 0 ? (
            <ul className="space-y-0.5">
              {sessions.map((session) => {
                const sessionAgents = agentsBySessionId[session.id] ?? [];
                const hasAgents = sessionAgents.length > 0;
                const expanded = expandedSessionIds.has(session.id);
                const isActiveSession = activeSessionId === session.id;
                return (
                  <li key={session.id} className="group">
                    <div
                      className={`rounded-sm text-xs transition-colors flex items-start gap-1 ${
                        isActiveSession ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"
                      }`}
                    >
                      {hasAgents ? (
                        <button
                          type="button"
                          onClick={() => toggleSessionExpanded(session.id)}
                          className="shrink-0 cursor-pointer p-1 mt-0.5 text-muted-foreground hover:text-foreground"
                          aria-label={expanded ? "Collapse session" : "Expand session"}
                        >
                          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                        </button>
                      ) : (
                        <span className="mt-0.5 block size-5 shrink-0" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectSession?.(session.id)}
                        className="flex-1 min-w-0 text-left py-1.5 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-foreground font-medium truncate">{session.title ?? "Untitled Session"}</span>
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
                                  <DropdownMenuItem variant="destructive" onSelect={() => onDeleteSession(session.id)}>
                                    Delete session
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                    {expanded && sessionAgents.length > 0 && (
                      <ul className="ml-5 mt-0.5 space-y-px border-l border-border/60 pl-2">
                        {sessionAgents.map((agent) => {
                          const isSelected = isActiveSession && selectedAgentId === agent.id;
                          return (
                            <li key={agent.id}>
                              <button
                                type="button"
                                onClick={() => onSelectAgent?.(session.id, agent.id)}
                                className={`flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-2xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-sidebar-accent text-foreground"
                                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                                }`}
                              >
                                <HugeiconsIcon
                                  icon={WorkoutRunIcon}
                                  className={`size-3 shrink-0 ${
                                    agent.status === "running"
                                      ? "text-primary animate-pulse"
                                      : agent.status === "completed"
                                        ? "text-green-500"
                                        : "text-muted-foreground/60"
                                  }`}
                                />
                                <span className="truncate">{agent.task}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground italic">No previous sessions</p>
          )}
        </div>
      </div>
    </div>
  );
}
