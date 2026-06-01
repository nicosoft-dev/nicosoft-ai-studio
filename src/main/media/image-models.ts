// Maps an image-model slug to its Gemini protocol + which params it accepts. Slug-pattern inference,
// mirroring renderer/src/lib/thinking.ts's getThinkingCapability. The single source on the MAIN side for
// "is this an image model, which series, what params" — the ns_generate_image executor uses it to pick
// the protocol. (B7's composer picker mirrors this in the renderer; B5's Tools settings pick the slug.)

import type { GeminiImageKind } from '../llm/gemini-image'

export interface ImageModelCaps {
  kind: GeminiImageKind
  aspectRatio: boolean
  resolution: boolean // Nano Banana: 1K / 2K / 4K
  count: boolean // Imagen sampleCount (Nano Banana is single-image)
}

// null = not an image model. 'imagen' wins over the generic '-image' check so imagen-* never falls into
// the Nano Banana branch.
export function imageModelCaps(slug: string): ImageModelCaps | null {
  const s = slug.toLowerCase()
  if (s.includes('imagen')) return { kind: 'imagen', aspectRatio: true, resolution: false, count: true }
  if (s.includes('nano-banana') || s.includes('-image')) {
    return { kind: 'nano-banana', aspectRatio: true, resolution: true, count: false }
  }
  return null
}

// Fallback image backend until the user configures one (B5 Tools settings default-model / B7 composer
// picker). A Nano Banana slug — generateContent IMAGE, the most broadly available image path.
export const DEFAULT_IMAGE_MODEL = 'nano-banana-pro-preview'
