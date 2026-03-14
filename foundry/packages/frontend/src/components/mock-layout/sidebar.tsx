import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { useStyletron } from "baseui";
import { LabelSmall, LabelXSmall } from "baseui/typography";
import { Select, type Value } from "baseui/select";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CloudUpload,
  CreditCard,
  GitPullRequestDraft,
  ListChecks,
  LogOut,
  PanelLeft,
  Plus,
  Settings,
  User,
} from "lucide-react";

import { formatRelativeAge, type Task, type ProjectSection } from "./view-model";
import { ContextMenuOverlay, TaskIndicator, PanelHeaderBar, SPanel, ScrollBody, useContextMenu } from "./ui";
import { activeMockOrganization, eligibleOrganizations, useMockAppClient, useMockAppSnapshot } from "../../lib/mock-app";
import { useFoundryTokens } from "../../app/theme";
import type { FoundryTokens } from "../../styles/tokens";

const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

/** Strip the org prefix (e.g. "rivet-dev/") when all repos share the same org. */
function stripCommonOrgPrefix(label: string, repos: Array<{ label: string }>): string {
  const slashIdx = label.indexOf("/");
  if (slashIdx < 0) return label;
  const prefix = label.slice(0, slashIdx + 1);
  if (repos.every((r) => r.label.startsWith(prefix))) {
    return label.slice(slashIdx + 1);
  }
  return label;
}

function projectInitial(label: string): string {
  const parts = label.split("/");
  const name = parts[parts.length - 1] ?? label;
  return name.charAt(0).toUpperCase();
}

function projectIconColor(label: string): string {
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length]!;
}

export const Sidebar = memo(function Sidebar({
  projects,
  newTaskRepos,
  selectedNewTaskRepoId,
  activeId,
  onSelect,
  onCreate,
  onSelectNewTaskRepo,
  onMarkUnread,
  onRenameTask,
  onRenameBranch,
  onReorderProjects,
  taskOrderByProject,
  onReorderTasks,
  onToggleSidebar,
}: {
  projects: ProjectSection[];
  newTaskRepos: Array<{ id: string; label: string }>;
  selectedNewTaskRepoId: string;
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (repoId?: string) => void;
  onSelectNewTaskRepo: (repoId: string) => void;
  onMarkUnread: (id: string) => void;
  onRenameTask: (id: string) => void;
  onRenameBranch: (id: string) => void;
  onReorderProjects: (fromIndex: number, toIndex: number) => void;
  taskOrderByProject: Record<string, string[]>;
  onReorderTasks: (projectId: string, fromIndex: number, toIndex: number) => void;
  onToggleSidebar?: () => void;
}) {
  const [css] = useStyletron();
  const t = useFoundryTokens();
  const contextMenu = useContextMenu();
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);

  // Mouse-based drag and drop state
  type DragState =
    | { type: "project"; fromIdx: number; overIdx: number | null }
    | { type: "task"; projectId: string; fromIdx: number; overIdx: number | null }
    | null;
  const [drag, setDrag] = useState<DragState>(null);
  const dragRef = useRef<DragState>(null);
  const startYRef = useRef(0);
  const didDragRef = useRef(false);

  // Attach global mousemove/mouseup when dragging
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      // Detect which element is under the cursor using data attributes
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return;
      const projectEl = (el as HTMLElement).closest?.("[data-project-idx]") as HTMLElement | null;
      const taskEl = (el as HTMLElement).closest?.("[data-task-idx]") as HTMLElement | null;

      if (drag.type === "project" && projectEl) {
        const overIdx = Number(projectEl.dataset.projectIdx);
        if (overIdx !== drag.overIdx) {
          setDrag({ ...drag, overIdx });
          dragRef.current = { ...drag, overIdx };
        }
      } else if (drag.type === "task" && taskEl) {
        const overProjectId = taskEl.dataset.taskProjectId ?? "";
        const overIdx = Number(taskEl.dataset.taskIdx);
        if (overProjectId === drag.projectId && overIdx !== drag.overIdx) {
          setDrag({ ...drag, overIdx });
          dragRef.current = { ...drag, overIdx };
        }
      }
      // Mark that we actually moved (to distinguish from clicks)
      if (Math.abs(e.clientY - startYRef.current) > 4) {
        didDragRef.current = true;
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      if (d && didDragRef.current && d.overIdx !== null && d.fromIdx !== d.overIdx) {
        if (d.type === "project") {
          onReorderProjects(d.fromIdx, d.overIdx);
        } else {
          onReorderTasks(d.projectId, d.fromIdx, d.overIdx);
        }
      }
      dragRef.current = null;
      didDragRef.current = false;
      setDrag(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [drag, onReorderProjects, onReorderTasks]);

  const [createSelectOpen, setCreateSelectOpen] = useState(false);
  const selectOptions = useMemo(() => newTaskRepos.map((repo) => ({ id: repo.id, label: stripCommonOrgPrefix(repo.label, newTaskRepos) })), [newTaskRepos]);

  return (
    <SPanel>
      <style>{`
        [data-project-header]:hover [data-chevron] {
          display: inline-flex !important;
        }
        [data-project-header]:hover [data-project-icon] {
          display: none !important;
        }
      `}</style>
      {import.meta.env.VITE_DESKTOP ? (
        <div
          className={css({
            height: "38px",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            paddingRight: "10px",
            flexShrink: 0,
            position: "relative",
            zIndex: 9999,
          })}
        >
          {onToggleSidebar ? (
            <div
              role="button"
              tabIndex={0}
              onClick={onToggleSidebar}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onToggleSidebar();
              }}
              className={css({
                width: "26px",
                height: "26px",
                borderRadius: "6px",
                color: t.textTertiary,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                ":hover": { color: t.textSecondary, backgroundColor: t.interactiveHover },
              })}
            >
              <PanelLeft size={14} />
            </div>
          ) : null}
        </div>
      ) : null}
      <PanelHeaderBar $style={{ backgroundColor: "transparent", borderBottom: "none" }}>
        <LabelSmall
          color={t.textPrimary}
          $style={{ fontWeight: 500, flex: 1, fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", lineHeight: 1 }}
        >
          <ListChecks size={14} />
          Tasks
        </LabelSmall>
        {!import.meta.env.VITE_DESKTOP && onToggleSidebar ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onToggleSidebar}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onToggleSidebar();
            }}
            className={css({
              width: "26px",
              height: "26px",
              borderRadius: "6px",
              color: t.textTertiary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              ":hover": { color: t.textSecondary, backgroundColor: t.interactiveHover },
            })}
          >
            <PanelLeft size={14} />
          </div>
        ) : null}
        {createSelectOpen ? (
          <div className={css({ flex: 1, minWidth: 0 })}>
            <Select
              options={selectOptions}
              value={[]}
              placeholder="Search repos..."
              type="search"
              openOnClick
              autoFocus
              onChange={({ value }: { value: Value }) => {
                const selected = value[0];
                if (selected) {
                  onSelectNewTaskRepo(selected.id as string);
                  setCreateSelectOpen(false);
                  onCreate(selected.id as string);
                }
              }}
              onClose={() => setCreateSelectOpen(false)}
              overrides={{
                Root: {
                  style: {
                    width: "100%",
                  },
                },
                ControlContainer: {
                  style: {
                    backgroundColor: t.surfaceTertiary,
                    borderTopColor: t.borderSubtle,
                    borderBottomColor: t.borderSubtle,
                    borderLeftColor: t.borderSubtle,
                    borderRightColor: t.borderSubtle,
                    borderTopWidth: "1px",
                    borderBottomWidth: "1px",
                    borderLeftWidth: "1px",
                    borderRightWidth: "1px",
                    borderTopLeftRadius: "6px",
                    borderTopRightRadius: "6px",
                    borderBottomLeftRadius: "6px",
                    borderBottomRightRadius: "6px",
                    minHeight: "28px",
                    paddingLeft: "8px",
                  },
                },
                ValueContainer: {
                  style: {
                    paddingTop: "0px",
                    paddingBottom: "0px",
                  },
                },
                Input: {
                  style: {
                    fontSize: "12px",
                    color: t.textPrimary,
                  },
                },
                Placeholder: {
                  style: {
                    fontSize: "12px",
                    color: t.textMuted,
                  },
                },
                Dropdown: {
                  style: {
                    backgroundColor: t.surfaceElevated,
                    borderTopColor: t.borderDefault,
                    borderBottomColor: t.borderDefault,
                    borderLeftColor: t.borderDefault,
                    borderRightColor: t.borderDefault,
                    maxHeight: "min(320px, 50vh)",
                  },
                },
                DropdownListItem: {
                  style: {
                    fontSize: "12px",
                    paddingTop: "6px",
                    paddingBottom: "6px",
                  },
                },
                IconsContainer: {
                  style: {
                    paddingRight: "4px",
                  },
                },
                SearchIconContainer: {
                  style: {
                    paddingLeft: "0px",
                    paddingRight: "4px",
                  },
                },
              }}
            />
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-disabled={newTaskRepos.length === 0}
            onClick={() => {
              if (newTaskRepos.length === 0) return;
              if (newTaskRepos.length === 1) {
                onSelectNewTaskRepo(newTaskRepos[0]!.id);
                onCreate(newTaskRepos[0]!.id);
              } else {
                setCreateSelectOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (newTaskRepos.length === 0) return;
              if (event.key === "Enter" || event.key === " ") {
                if (newTaskRepos.length === 1) {
                  onSelectNewTaskRepo(newTaskRepos[0]!.id);
                  onCreate(newTaskRepos[0]!.id);
                } else {
                  setCreateSelectOpen(true);
                }
              }
            }}
            className={css({
              width: "26px",
              height: "26px",
              borderRadius: "8px",
              backgroundColor: newTaskRepos.length > 0 ? t.borderMedium : t.interactiveHover,
              color: t.textPrimary,
              cursor: newTaskRepos.length > 0 ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 200ms ease",
              flexShrink: 0,
              opacity: newTaskRepos.length > 0 ? 1 : 0.6,
              ":hover": newTaskRepos.length > 0 ? { backgroundColor: "rgba(255, 255, 255, 0.20)" } : undefined,
            })}
          >
            <Plus size={14} style={{ display: "block" }} />
          </div>
        )}
      </PanelHeaderBar>
      <ScrollBody>
        <div className={css({ padding: "8px", display: "flex", flexDirection: "column", gap: "4px" })}>
          {projects.map((project, projectIndex) => {
            const isCollapsed = collapsedProjects[project.id] === true;
            const isProjectDropTarget = drag?.type === "project" && drag.overIdx === projectIndex && drag.fromIdx !== projectIndex;
            const isBeingDragged = drag?.type === "project" && drag.fromIdx === projectIndex && didDragRef.current;
            const orderedTaskIds = taskOrderByProject[project.id];
            const orderedTasks = orderedTaskIds
              ? (() => {
                  const byId = new Map(project.tasks.map((t) => [t.id, t]));
                  const sorted = orderedTaskIds.map((id) => byId.get(id)).filter(Boolean) as typeof project.tasks;
                  for (const t of project.tasks) {
                    if (!orderedTaskIds.includes(t.id)) sorted.push(t);
                  }
                  return sorted;
                })()
              : project.tasks;

            return (
              <div
                key={project.id}
                data-project-idx={projectIndex}
                className={css({
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  position: "relative",
                  opacity: isBeingDragged ? 0.4 : 1,
                  transition: "opacity 150ms ease",
                  "::before": {
                    content: '""',
                    position: "absolute",
                    top: "-2px",
                    left: 0,
                    right: 0,
                    height: "2px",
                    backgroundColor: isProjectDropTarget ? t.textPrimary : "transparent",
                    transition: "background-color 100ms ease",
                  },
                })}
              >
                <div
                  onMouseEnter={() => setHoveredProjectId(project.id)}
                  onMouseLeave={() => setHoveredProjectId((cur) => (cur === project.id ? null : cur))}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return;
                    startYRef.current = event.clientY;
                    didDragRef.current = false;
                    setHoveredProjectId(null);
                    const state: DragState = { type: "project", fromIdx: projectIndex, overIdx: null };
                    dragRef.current = state;
                    setDrag(state);
                  }}
                  onClick={() => {
                    if (!didDragRef.current) {
                      setCollapsedProjects((current) => ({
                        ...current,
                        [project.id]: !current[project.id],
                      }));
                    }
                  }}
                  data-project-header
                  className={css({
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 8px 4px",
                    gap: "8px",
                    cursor: "grab",
                    userSelect: "none",
                  })}
                >
                  <div className={css({ display: "flex", alignItems: "center", gap: "4px", overflow: "hidden" })}>
                    <div className={css({ position: "relative", width: "14px", height: "14px", flexShrink: 0 })}>
                      <span
                        className={css({
                          position: "absolute",
                          inset: 0,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: "3px",
                          fontSize: "9px",
                          fontWeight: 700,
                          lineHeight: 1,
                          color: t.textOnAccent,
                          backgroundColor: projectIconColor(project.label),
                        })}
                        data-project-icon
                      >
                        {projectInitial(project.label)}
                      </span>
                      <span className={css({ position: "absolute", inset: 0, display: "none", alignItems: "center", justifyContent: "center" })} data-chevron>
                        {isCollapsed ? <ChevronDown size={12} color={t.textTertiary} /> : <ChevronUp size={12} color={t.textTertiary} />}
                      </span>
                    </div>
                    <LabelSmall
                      color={t.textSecondary}
                      $style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {stripCommonOrgPrefix(project.label, projects)}
                    </LabelSmall>
                  </div>
                  <div className={css({ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 })}>
                    {isCollapsed ? <LabelXSmall color={t.textTertiary}>{formatRelativeAge(project.updatedAtMs)}</LabelXSmall> : null}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setHoveredProjectId(null);
                        onSelectNewTaskRepo(project.id);
                        onCreate(project.id);
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={css({
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "26px",
                        height: "26px",
                        borderRadius: "6px",
                        border: "none",
                        background: "none",
                        padding: 0,
                        margin: 0,
                        cursor: "pointer",
                        color: t.textTertiary,
                        opacity: hoveredProjectId === project.id ? 1 : 0,
                        transition: "opacity 150ms ease, background 200ms ease, color 200ms ease",
                        pointerEvents: hoveredProjectId === project.id ? "auto" : "none",
                        ":hover": { backgroundColor: t.interactiveHover, color: t.textSecondary },
                      })}
                      title={`New task in ${project.label}`}
                    >
                      <Plus size={12} color={t.textTertiary} />
                    </button>
                  </div>
                </div>

                {!isCollapsed &&
                  orderedTasks.map((task, taskIndex) => {
                    const isActive = task.id === activeId;
                    const isDim = task.status === "archived";
                    const isRunning = task.tabs.some((tab) => tab.status === "running");
                    const isProvisioning =
                      String(task.status).startsWith("init_") ||
                      task.status === "new" ||
                      task.tabs.some((tab) => tab.status === "pending_provision" || tab.status === "pending_session_create");
                    const hasUnread = task.tabs.some((tab) => tab.unread);
                    const isDraft = task.pullRequest == null || task.pullRequest.status === "draft";
                    const totalAdded = task.fileChanges.reduce((sum, file) => sum + file.added, 0);
                    const totalRemoved = task.fileChanges.reduce((sum, file) => sum + file.removed, 0);
                    const hasDiffs = totalAdded > 0 || totalRemoved > 0;
                    const isTaskDropTarget = drag?.type === "task" && drag.projectId === project.id && drag.overIdx === taskIndex && drag.fromIdx !== taskIndex;
                    const isTaskBeingDragged = drag?.type === "task" && drag.projectId === project.id && drag.fromIdx === taskIndex && didDragRef.current;

                    return (
                      <div
                        key={task.id}
                        data-task-idx={taskIndex}
                        data-task-project-id={project.id}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return;
                          // Only start task drag if not already in a project drag
                          if (dragRef.current) return;
                          event.stopPropagation();
                          startYRef.current = event.clientY;
                          didDragRef.current = false;
                          const state: DragState = { type: "task", projectId: project.id, fromIdx: taskIndex, overIdx: null };
                          dragRef.current = state;
                          setDrag(state);
                        }}
                        onClick={() => {
                          if (!didDragRef.current) {
                            onSelect(task.id);
                          }
                        }}
                        onContextMenu={(event) =>
                          contextMenu.open(event, [
                            { label: "Rename task", onClick: () => onRenameTask(task.id) },
                            { label: "Rename branch", onClick: () => onRenameBranch(task.id) },
                            { label: "Mark as unread", onClick: () => onMarkUnread(task.id) },
                          ])
                        }
                        className={css({
                          padding: "8px 12px",
                          borderRadius: "8px",
                          position: "relative",
                          backgroundColor: isActive ? t.interactiveHover : "transparent",
                          opacity: isTaskBeingDragged ? 0.4 : 1,
                          cursor: "pointer",
                          transition: "all 150ms ease",
                          "::before": {
                            content: '""',
                            position: "absolute",
                            top: "-2px",
                            left: 0,
                            right: 0,
                            height: "2px",
                            backgroundColor: isTaskDropTarget ? t.textPrimary : "transparent",
                            transition: "background-color 100ms ease",
                          },
                          ":hover": {
                            backgroundColor: t.interactiveHover,
                          },
                        })}
                      >
                        <div className={css({ display: "flex", alignItems: "center", gap: "8px" })}>
                          <div
                            className={css({
                              width: "14px",
                              minWidth: "14px",
                              height: "14px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            })}
                          >
                            <TaskIndicator isRunning={isRunning} isProvisioning={isProvisioning} hasUnread={hasUnread} isDraft={isDraft} />
                          </div>
                          <LabelSmall
                            $style={{
                              fontWeight: hasUnread ? 600 : 400,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                              flexShrink: 1,
                            }}
                            color={hasUnread ? t.textPrimary : t.textSecondary}
                          >
                            {task.title}
                          </LabelSmall>
                          {task.pullRequest != null ? (
                            <span className={css({ display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 })}>
                              <LabelXSmall color={t.textSecondary} $style={{ fontWeight: 600 }}>
                                #{task.pullRequest.number}
                              </LabelXSmall>
                              {task.pullRequest.status === "draft" ? <CloudUpload size={11} color={t.accent} /> : null}
                            </span>
                          ) : (
                            <GitPullRequestDraft size={11} color={t.textTertiary} />
                          )}
                          {hasDiffs ? (
                            <div className={css({ display: "flex", gap: "4px", flexShrink: 0, marginLeft: "auto" })}>
                              <span className={css({ fontSize: "11px", color: t.statusSuccess })}>+{totalAdded}</span>
                              <span className={css({ fontSize: "11px", color: t.statusError })}>-{totalRemoved}</span>
                            </div>
                          ) : null}
                          <LabelXSmall color={t.textTertiary} $style={{ flexShrink: 0, marginLeft: hasDiffs ? undefined : "auto" }}>
                            {formatRelativeAge(task.updatedAtMs)}
                          </LabelXSmall>
                        </div>
                      </div>
                    );
                  })}
                {/* Bottom drop zone for dragging to end of task list */}
                {!isCollapsed && (
                  <div
                    data-task-idx={orderedTasks.length}
                    data-task-project-id={project.id}
                    className={css({
                      minHeight: "4px",
                      position: "relative",
                      "::before": {
                        content: '""',
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "2px",
                        backgroundColor:
                          drag?.type === "task" && drag.projectId === project.id && drag.overIdx === orderedTasks.length && drag.fromIdx !== orderedTasks.length
                            ? t.textPrimary
                            : "transparent",
                        transition: "background-color 100ms ease",
                      },
                    })}
                  />
                )}
              </div>
            );
          })}
          {/* Bottom drop zone for dragging project to end of list */}
          <div
            data-project-idx={projects.length}
            className={css({
              minHeight: "4px",
              position: "relative",
              "::before": {
                content: '""',
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "2px",
                backgroundColor:
                  drag?.type === "project" && drag.overIdx === projects.length && drag.fromIdx !== projects.length ? t.textPrimary : "transparent",
                transition: "background-color 100ms ease",
              },
            })}
          />
        </div>
      </ScrollBody>
      <SidebarFooter />
      {contextMenu.menu ? <ContextMenuOverlay menu={contextMenu.menu} onClose={contextMenu.close} /> : null}
    </SPanel>
  );
});

const menuButtonStyle = (highlight: boolean, tokens: FoundryTokens) =>
  ({
    display: "flex",
    alignItems: "center",
    gap: "10px",
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    border: "none",
    background: highlight ? tokens.interactiveHover : "transparent",
    color: tokens.textSecondary,
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 400 as const,
    textAlign: "left" as const,
    transition: "background 120ms ease, color 120ms ease",
  }) satisfies React.CSSProperties;

function SidebarFooter() {
  const [css] = useStyletron();
  const t = useFoundryTokens();
  const navigate = useNavigate();
  const client = useMockAppClient();
  const snapshot = useMockAppSnapshot();
  const organization = activeMockOrganization(snapshot);
  const [open, setOpen] = useState(false);
  const [workspaceFlyoutOpen, setWorkspaceFlyoutOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const flyoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceTriggerRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (workspaceFlyoutOpen && workspaceTriggerRef.current) {
      const rect = workspaceTriggerRef.current.getBoundingClientRect();
      setFlyoutPos({ top: rect.top, left: rect.right + 4 });
    }
  }, [workspaceFlyoutOpen]);

  useEffect(() => {
    if (!open) return;
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inFlyout = flyoutRef.current?.contains(target);
      if (!inContainer && !inFlyout) {
        setOpen(false);
        setWorkspaceFlyoutOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const switchToOrg = useCallback(
    (org: (typeof snapshot.organizations)[number]) => {
      setOpen(false);
      setWorkspaceFlyoutOpen(false);
      void (async () => {
        await client.selectOrganization(org.id);
        await navigate({ to: `/workspaces/${org.workspaceId}` as never });
      })();
    },
    [client, navigate],
  );

  const openFlyout = useCallback(() => {
    if (flyoutTimerRef.current) clearTimeout(flyoutTimerRef.current);
    setWorkspaceFlyoutOpen(true);
  }, []);

  const closeFlyout = useCallback(() => {
    flyoutTimerRef.current = setTimeout(() => setWorkspaceFlyoutOpen(false), 150);
  }, []);

  const menuItems: Array<{ icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }> = [];

  if (organization) {
    menuItems.push(
      {
        icon: <Settings size={14} />,
        label: "Settings",
        onClick: () => {
          setOpen(false);
          void navigate({ to: "/organizations/$organizationId/settings" as never, params: { organizationId: organization.id } as never });
        },
      },
      {
        icon: <CreditCard size={14} />,
        label: "Billing",
        onClick: () => {
          setOpen(false);
          void navigate({ to: "/organizations/$organizationId/billing" as never, params: { organizationId: organization.id } as never });
        },
      },
    );
  }

  menuItems.push(
    {
      icon: <User size={14} />,
      label: "Account",
      onClick: () => {
        setOpen(false);
        void navigate({ to: "/account" as never });
      },
    },
    {
      icon: <LogOut size={14} />,
      label: "Sign Out",
      danger: true,
      onClick: () => {
        setOpen(false);
        void (async () => {
          await client.signOut();
          await navigate({ to: "/signin" });
        })();
      },
    },
  );

  const popoverStyle = css({
    borderRadius: "10px",
    border: `1px solid ${t.borderDefault}`,
    backgroundColor: t.surfaceElevated,
    boxShadow: `${t.shadow}, 0 0 0 1px ${t.interactiveSubtle}`,
    padding: "4px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  });

  return (
    <div ref={containerRef} className={css({ position: "relative", flexShrink: 0 })}>
      {open ? (
        <div
          className={css({
            position: "absolute",
            bottom: "100%",
            left: "8px",
            right: "8px",
            marginBottom: "4px",
            zIndex: 9999,
          })}
        >
          <div className={popoverStyle}>
            {/* Workspace flyout trigger */}
            {organization ? (
              <div ref={workspaceTriggerRef} onMouseEnter={openFlyout} onMouseLeave={closeFlyout}>
                <button
                  type="button"
                  onClick={() => setWorkspaceFlyoutOpen((prev) => !prev)}
                  className={css({
                    ...menuButtonStyle(workspaceFlyoutOpen, t),
                    fontWeight: 500,
                    ":hover": {
                      backgroundColor: t.interactiveHover,
                      color: t.textPrimary,
                    },
                  })}
                >
                  <span
                    className={css({
                      width: "18px",
                      height: "18px",
                      borderRadius: "4px",
                      background: `linear-gradient(135deg, ${projectIconColor(organization.settings.displayName)}, ${projectIconColor(organization.settings.displayName + "x")})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "9px",
                      fontWeight: 700,
                      color: t.textOnAccent,
                      flexShrink: 0,
                    })}
                  >
                    {organization.settings.displayName.charAt(0).toUpperCase()}
                  </span>
                  <span className={css({ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                    {organization.settings.displayName}
                  </span>
                  <ChevronRight size={12} className={css({ flexShrink: 0, color: t.textMuted })} />
                </button>
              </div>
            ) : null}

            {/* Workspace flyout portal */}
            {workspaceFlyoutOpen && organization && flyoutPos
              ? createPortal(
                  <div
                    ref={flyoutRef}
                    className={css({
                      position: "fixed",
                      top: `${flyoutPos.top}px`,
                      left: `${flyoutPos.left}px`,
                      minWidth: "200px",
                      zIndex: 10000,
                    })}
                    onMouseEnter={() => {
                      openFlyout();
                    }}
                    onMouseLeave={() => {
                      closeFlyout();
                    }}
                  >
                    <div className={popoverStyle}>
                      {eligibleOrganizations(snapshot).map((org) => {
                        const isActive = organization.id === org.id;
                        return (
                          <button
                            key={org.id}
                            type="button"
                            onClick={() => {
                              if (!isActive) switchToOrg(org);
                              else {
                                setOpen(false);
                                setWorkspaceFlyoutOpen(false);
                              }
                            }}
                            className={css({
                              ...menuButtonStyle(isActive, t),
                              fontWeight: isActive ? 600 : 400,
                              color: isActive ? t.textPrimary : t.textTertiary,
                              ":hover": {
                                backgroundColor: t.interactiveHover,
                                color: t.textPrimary,
                              },
                            })}
                          >
                            <span
                              className={css({
                                width: "18px",
                                height: "18px",
                                borderRadius: "4px",
                                background: `linear-gradient(135deg, ${projectIconColor(org.settings.displayName)}, ${projectIconColor(org.settings.displayName + "x")})`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "9px",
                                fontWeight: 700,
                                color: t.textOnAccent,
                                flexShrink: 0,
                              })}
                            >
                              {org.settings.displayName.charAt(0).toUpperCase()}
                            </span>
                            <span className={css({ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                              {org.settings.displayName}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>,
                  document.body,
                )
              : null}

            {menuItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={item.onClick}
                className={css({
                  ...menuButtonStyle(false, t),
                  color: item.danger ? t.statusError : t.textSecondary,
                  ":hover": {
                    backgroundColor: t.interactiveHover,
                    color: item.danger ? t.statusError : t.textPrimary,
                  },
                })}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={css({ padding: "8px" })}>
        <button
          type="button"
          onClick={() => {
            setOpen((prev) => {
              if (prev) setWorkspaceFlyoutOpen(false);
              return !prev;
            });
          }}
          className={css({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            border: "none",
            background: open ? t.interactiveHover : "transparent",
            color: open ? t.textPrimary : t.textTertiary,
            cursor: "pointer",
            transition: "all 160ms ease",
            ":hover": {
              backgroundColor: t.interactiveHover,
              color: t.textSecondary,
            },
          })}
        >
          <Settings size={14} />
        </button>
      </div>
    </div>
  );
}
