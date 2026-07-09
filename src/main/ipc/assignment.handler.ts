import { ipcMain } from 'electron'
import * as assignmentService from '../services/assignment.service'
import type { AssignmentDto, AssignmentListFilter } from './contracts'

// Assignments over IPC — READ-ONLY by design (docs/assignments-design.md §5): rows are system-created at
// the working role's run entry and auto-settled there; the renderer only lists them and follows the
// `assignment:changed` broadcast (emitted by assignment.service on every real transition).

function toDto(r: assignmentService.AssignmentRow): AssignmentDto {
  return {
    id: r.id,
    batchId: r.batchId,
    batchTitle: r.batchTitle,
    title: r.title,
    convId: r.convId,
    projectId: r.projectId,
    origin: r.origin,
    roleId: r.roleId,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  }
}

export function registerAssignmentHandlers(): void {
  ipcMain.handle('assignment:list', (_e, filter: AssignmentListFilter = {}): AssignmentDto[] =>
    assignmentService.list(filter).map(toDto)
  )
}
