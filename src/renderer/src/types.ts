// Core domain types consumed by the UI. Most screens now read real IPC-backed data; the few types
// still backing the static studio-data seed (Expert, Greeting, ExtensionsData) sit alongside the
// domain types (Conversation, Project, MemoryItem, …) used by the real views.

export type Family = 'anthropic' | 'openai' | 'gemini' | null

export interface Expert {
  id: string
  name: string
  color: string
  specialty: string
  personality: string
  model: string | null
  family: Family
  coordinator?: boolean
  custom?: boolean
  unconfigured?: boolean
}

export type BlockType = 'para' | 'quote' | 'code' | 'imagecard' | 'notice'
export interface Block {
  type: BlockType
  html?: string
  lang?: string
  code?: string
}

export interface Segment {
  who: string // 'user' | expertId
  model?: string
  ts?: string
  synthesis?: boolean
  streaming?: boolean
  blocks: Block[]
}

export interface Conversation {
  title: string
  expert: string
  collab?: boolean
  dispatch?: string[]
  notice?: boolean
  loading?: boolean
  segments: Segment[]
}

export interface MemoryItem {
  id: string
  text: string
}

export interface McpServer {
  name: string
  transport: 'http' | 'stdio'
  endpoint: string
  status: 'connected' | 'error' | 'idle'
  tools: number
  scope: 'all' | string[]
  error?: string
}
export interface Skill {
  name: string
  desc: string
  source: string
  enabled: boolean
  scope: 'all' | string[]
}
export interface PluginBundle {
  type: 'skill' | 'mcp' | 'role'
  name: string
}
export interface Plugin {
  name: string
  desc: string
  source: string
  enabled: boolean
  bundles: PluginBundle[]
  summary: string
}
export interface ExtensionsData {
  mcp: McpServer[]
  skills: Skill[]
  plugins: Plugin[]
}

export interface RoleBinding {
  id: string
  family: Family
  model: string
}
export interface Greeting {
  greeting: string
  chips: string[]
}
export interface ProjectTask {
  id: string
  title: string
  expert: string
  deps: string[]
  status: 'done' | 'doing' | 'todo'
  output: string | null
}
export interface ProjectTest {
  id: string
  title: string
  status: 'pass' | 'pending' | 'fail'
}
export interface Project {
  id: string
  title: string
  summary: string
  goal: string
  phase: string
  progress: number
  chair: string
  experts: string[]
  plan: ProjectTask[]
  tests: ProjectTest[]
}

export interface StudioData {
  EXPERTS: Expert[]
  EXPERT_BY_ID: Record<string, Expert>
  GREETINGS: Record<string, Greeting>
  USER_PROFILE: { name: string }
  EXTENSIONS: ExtensionsData
}
