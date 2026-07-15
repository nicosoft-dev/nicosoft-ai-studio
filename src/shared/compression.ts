// Cross-process single source for the compaction trigger ratio. main (compression.service) folds a
// conversation when its measured context crosses this share of the model's window; the renderer
// (context-popover) uses the SAME ratio to recognise the dead-end state where folding cannot help —
// system prompt + tools + memories are irreducible (folding removes only messages), so once they alone
// exceed ratio·window no fold can ever get back under the trigger and the panel should say so instead
// of letting the user wonder why compaction "isn't working". Environment-neutral: no node, no DOM.
export const COMPRESS_RATIO = 0.9
