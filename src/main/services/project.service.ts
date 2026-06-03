import * as repo from '../repos/project.repo'
import * as rolesService from './roles.service'
import * as titleService from './title.service'
import type {
  ProjectDto,
  ProjectTaskDto,
  ProjectTestDto,
  ProjectCreateInput,
  ProjectTaskInput,
  ProjectPhase,
  ProjectTaskStatus,
  ProjectTestStatus,
} from '../ipc/contracts'

// Project business logic: row CRUD via project.repo + the derived view (progress/experts) the renderer
// consumes. A ProjectDto bundles a project with its full plan + tests; list() returns the same shape as
// get() so the Projects list and the Workbench detail share one type. No SQL here — that's the repo.

const CHAIR = 'coordinator' // the orchestrator role; always first in the experts stack

function taskToDto(t: repo.ProjectTaskRow): ProjectTaskDto {
  return { id: t.id, stepNo: t.stepNo, title: t.title, assigneeRoleId: t.assigneeRoleId, deps: t.deps, status: t.status, output: t.output }
}
function testToDto(t: repo.ProjectTestRow): ProjectTestDto {
  return { id: t.id, title: t.title, status: t.status }
}

// Join a project row with its children into the renderer-facing view. progress = done/total tasks;
// experts = coordinator + the distinct task assignees in step order (null assignees skipped).
function assemble(p: repo.ProjectRow, tasks: repo.ProjectTaskRow[], tests: repo.ProjectTestRow[]): ProjectDto {
  const done = tasks.filter((t) => t.status === 'done').length
  const progress = tasks.length ? done / tasks.length : 0
  const seen = new Set<string>([CHAIR])
  const experts: string[] = [CHAIR]
  for (const t of tasks) {
    if (t.assigneeRoleId && !seen.has(t.assigneeRoleId)) {
      seen.add(t.assigneeRoleId)
      experts.push(t.assigneeRoleId)
    }
  }
  return {
    id: p.id,
    title: p.title,
    goal: p.goal,
    cwd: p.cwd,
    phase: p.phase,
    progress,
    experts,
    plan: tasks.map(taskToDto),
    tests: tests.map(testToDto),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }
}

export function list(): ProjectDto[] {
  return repo.listProjects().map((p) => assemble(p, repo.listTasks(p.id), repo.listTests(p.id)))
}

export function get(id: string): ProjectDto | null {
  const p = repo.getProject(id)
  return p ? assemble(p, repo.listTasks(p.id), repo.listTests(p.id)) : null
}

// Create a project. A blank title is auto-generated from the goal via the title service — a small/fast
// model on the coordinator's endpoint, falling back to its MAIN model when there's no smaller sibling,
// then to a goal truncation. Covers New Project (blank name) + coordinator-created projects.
export async function create(input: ProjectCreateInput): Promise<ProjectDto> {
  const title = input.title?.trim() || (await generateName(input.goal ?? ''))
  const p = repo.insertProject({ title, goal: input.goal ?? null, cwd: input.cwd ?? null })
  return assemble(p, [], [])
}

async function generateName(goal: string): Promise<string> {
  const fallback =
    goal
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean)
      ?.slice(0, 57) || 'Untitled project'
  const b = rolesService.getBinding('coordinator')
  if (!b?.endpointId || !b.model || !goal.trim()) return fallback
  try {
    return await titleService.generate({ firstMessage: goal, endpointId: b.endpointId, model: b.model })
  } catch {
    return fallback
  }
}

export function remove(id: string): void {
  repo.removeProject(id)
}

export function setPhase(id: string, phase: ProjectPhase): void {
  repo.updateProjectPhase(id, phase)
}

export function addTask(projectId: string, input: ProjectTaskInput): ProjectTaskDto {
  const stepNo = input.stepNo ?? repo.listTasks(projectId).length + 1
  const t = repo.insertTask({ projectId, stepNo, title: input.title, assigneeRoleId: input.assigneeRoleId ?? null, deps: input.deps ?? [] })
  repo.touchProject(projectId)
  return taskToDto(t)
}

export function setTaskStatus(projectId: string, taskId: string, status: ProjectTaskStatus, output?: string | null): void {
  repo.updateTaskStatus(taskId, status, output)
  repo.touchProject(projectId)
}

export function addTest(projectId: string, title: string): ProjectTestDto {
  const t = repo.insertTest(projectId, title)
  repo.touchProject(projectId)
  return testToDto(t)
}

export function setTestStatus(projectId: string, testId: string, status: ProjectTestStatus): void {
  repo.updateTestStatus(testId, status)
  repo.touchProject(projectId)
}
