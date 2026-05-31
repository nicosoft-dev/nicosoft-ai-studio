// The agent's tool registry. CORE_TOOLS is the H1 set (Read + Bash); later phases add
// Write/Edit/MultiEdit/Grep/Glob/LS/Todo/Task. The casts erase each tool's concrete input/output
// generics down to the registry's uniform `Tool` — the runtime shape is identical.

import type { Tool } from './tool'
import { bashTool } from './tools/bash'
import { readTool } from './tools/read'

export const CORE_TOOLS: readonly Tool[] = [readTool as unknown as Tool, bashTool as unknown as Tool]
