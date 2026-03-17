export const TASK_QUEUE_NAMES = [
  "task.command.initialize",
  "task.command.provision",
  "task.command.attach",
  "task.command.switch",
  "task.command.push",
  "task.command.sync",
  "task.command.merge",
  "task.command.archive",
  "task.command.kill",
  "task.command.get",
  "task.command.pull_request.sync",
  "task.command.workspace.mark_unread",
  "task.command.workspace.rename_task",
  "task.command.workspace.create_session",
  "task.command.workspace.create_session_and_send",
  "task.command.workspace.ensure_session",
  "task.command.workspace.rename_session",
  "task.command.workspace.select_session",
  "task.command.workspace.set_session_unread",
  "task.command.workspace.update_draft",
  "task.command.workspace.change_model",
  "task.command.workspace.send_message",
  "task.command.workspace.stop_session",
  "task.command.workspace.sync_session_status",
  "task.command.workspace.refresh_derived",
  "task.command.workspace.refresh_session_transcript",
  "task.command.workspace.close_session",
  "task.command.workspace.publish_pr",
  "task.command.workspace.revert_file",
  "task.command.workspace.change_owner",
] as const;

export type TaskQueueName = (typeof TASK_QUEUE_NAMES)[number];

export function taskWorkflowQueueName(name: string): string {
  return name;
}
