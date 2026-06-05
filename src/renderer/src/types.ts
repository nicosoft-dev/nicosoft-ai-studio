// Core domain types consumed by the UI. Batch 0: typed against the (mock) STUDIO_DATA;
// later batches replace the data source with real IPC-backed services.

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

export interface ExpertMemory {
  role: MemoryItem[]
  collab: MemoryItem[]
}

export interface MemoryData {
  selfLearning: { master: boolean; perExpert: Record<string, boolean> }
  shared: MemoryItem[]
  byExpert: Record<string, ExpertMemory>
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

export interface ShareSlice {
  id: string
  pct: number
}
export interface NamedValue {
  id?: string
  label?: string
  v: number
  family?: Family
}
export interface StudioModule {
  status: Record<string, 'idle' | 'working' | 'routing'>
  activity: Record<string, number>
  stats: {
    tokensToday: string
    tokensIn: string
    tokensOut: string
    conversations: { inProgress: number; done: number; total: number }
    share: ShareSlice[]
  }
  timeline: {
    inProgress: { convId: string; expert: string; title: string; progress: string }[]
    projects: {
      id: string
      title: string
      chain: string[]
      status: string
      steps: { expert: string; role: string; state: string }[]
    }[]
  }
  analytics: {
    usage: {
      tokensIn: string
      tokensOut: string
      tokensTotal: string
      tokensAllTime: string
      byDay: { d: string; v: number }[]
      conversations: { inProgress: number; done: number; total: number }
      byExpert: NamedValue[]
      byModel: NamedValue[]
      byProvider: NamedValue[]
    }
    memory: {
      perExpert: NamedValue[]
      total: number
      layers: { key: string; label: string; v: number; hint: string }[]
      learning: { corrected: number; approved: number; byWeek: number[] }
    }
    activity: {
      byDay: number[]
      mostActive: { id: string; today: number; week: number }
      tools: { label: string; v: number; icon: string }[]
      peakHours: number[]
    }
  }
}

export interface EndpointHealth {
  family: string
  status: string
  models: number
  checked: string
}
export interface EndpointRow {
  name: string
  proto: Family
  status: string
  models: string[] // configured model slugs this endpoint serves; Roles binds to one of these
  key: string
  baseURL?: string
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
export interface HistoryGroup {
  group: string
  items: { id: string; title: string; expert: string }[]
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
  ENDPOINT_HEALTH: EndpointHealth[]
  ENDPOINTS: EndpointRow[]
  ROLE_BINDINGS: RoleBinding[]
  GREETINGS: Record<string, Greeting>
  HISTORY: HistoryGroup[]
  CONVERSATIONS: Record<string, Conversation>
  STUDIO: StudioModule
  USER_PROFILE: { name: string }
  EXTENSIONS: ExtensionsData
  MEMORY: MemoryData
  PROJECTS: Project[]
}
