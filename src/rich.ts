// ─── Rich-link + poll content helpers (pure, unit-testable) ─────────────────
//
// B20 asset links render as platform-native rich-link previews ("clean image
// content type") and swap confirmations use tap-to-answer polls. The pure
// text/choice mapping lives here so the smoke test can pin it down.

export const BASESCAN_TOKEN_URL_RE = /https:\/\/basescan\.org\/token\/0x[0-9a-fA-F]{40}/g;

export function extractBasescanTokenUrls(text: string): string[] {
  return text.match(BASESCAN_TOKEN_URL_RE) ?? [];
}

export function stripBasescanTokenUrls(text: string): string {
  return text
    .replace(BASESCAN_TOKEN_URL_RE, ' ')
    .replace(/\s*👀\s*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Map a tapped poll choice onto the confirm/cancel flow. Anything else is
// returned as-is so the caller can route it to the agent as natural language.
export function pollChoiceToToken(choice: string): string | null {
  const label = choice.trim().toLowerCase();
  if (label.includes('confirm') || label === 'yes' || label === 'y') return 'confirm';
  if (label.includes('cancel') || label === 'no' || label === 'n') return 'cancel';
  return null;
}