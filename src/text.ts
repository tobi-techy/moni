// ─── Outgoing message text hygiene ──────────────────────────────────────────
//
// Moni's voice is plain iMessage prose: no em-dashes. LLMs sprinkle them in
// anyway, so instead of relying on prompt discipline alone we sanitize every
// user-facing string deterministically at the send boundary.

/**
 * Strip em-dashes (and stray en-dashes used as separators) from outgoing text.
 * - Dashes at line starts are dropped (keeps the line break intact)
 * - Spaced mid-sentence dashes become a comma
 * - Glued dashes become a plain hyphen
 */
export function sanitizeOutgoingText(text: string): string {
  return text
    .replace(/^[\u2014\u2013][ \t]*/gm, '')   // line-leading "— " -> drop
    .replace(/ [\u2014\u2013] /g, ', ')       // " word — word " -> " word, word "
    .replace(/[\u2014\u2013]/g, '-');         // any remainder -> hyphen
}

/**
 * Wrap a Spectrum space so every string passed to send() is sanitized.
 * Builder payloads (markdown(), typing(), ...) pass through untouched — their
 * text must be sanitized at construction time (see `md` in index.ts).
 */
export function sanitizeSpace<T extends { send: (content: any) => Promise<any> }>(space: T): T {
  const anySpace = space as any;
  if (!anySpace || typeof anySpace.send !== 'function' || anySpace._moniSanitized) {
    return space;
  }
  const originalSend = anySpace.send.bind(space);
  anySpace.send = async (content: any) =>
    originalSend(typeof content === 'string' ? sanitizeOutgoingText(content) : content);
  anySpace._moniSanitized = true;
  return space;
}
