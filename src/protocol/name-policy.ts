const FALLBACK_NAME = "Player";
const MAX_NAME_LENGTH = 16;

// Family-friendly server policy. Matching ignores punctuation and common numeric
// substitutions so custom names cannot bypass it with simple separators/leetspeak.
const BLOCKED = [
  "asshole", "bastard", "bitch", "bullshit", "cocksucker", "cunt", "dick",
  "faggot", "fuck", "goddamn", "motherfucker", "nigger", "porn", "pussy",
  "retard", "shit", "slut", "whore",
] as const;
const BLOCKED_WHOLE_NAMES = ["ass", "damn", "hell", "piss", "sex"] as const;

/**
 * Code points that carry no visible glyph of their own but change how the text around
 * them renders — or render as nothing at all. A display name is echoed into the
 * leaderboard, the tank list, the public evidence log and the TXT export, so any of
 * these lets one player reorder or impersonate another player's row.
 *
 * Ranges, and why each is here:
 *   0000-001F, 007F-009F  C0 controls, DEL, C1 controls
 *   00AD                  SOFT HYPHEN (invisible Cf)
 *   034F                  COMBINING GRAPHEME JOINER (invisible)
 *   061C                  ARABIC LETTER MARK (bidi Cf)
 *   115F, 1160            HANGUL CHOSEONG/JUNGSEONG FILLER (blank glyphs)
 *   180B-180F             Mongolian free variation selectors + MONGOLIAN VOWEL SEPARATOR
 *   200B-200F             ZWSP, ZWNJ, ZWJ, LRM, RLM
 *   2028, 2029            LINE / PARAGRAPH SEPARATOR (would break the TXT export)
 *   202A-202E             LRE, RLE, PDF, LRO, RLO — the bidi override spoofing vector
 *   2060-206F             WORD JOINER, invisible operators, 2066-2069 isolates,
 *                         206A-206F deprecated format controls
 *   3164, FFA0            HANGUL FILLER, HALFWIDTH HANGUL FILLER (blank glyphs)
 *   FEFF                  ZERO WIDTH NO-BREAK SPACE / BOM
 *   FFF9-FFFB             interlinear annotation controls
 *   1D173-1D17A           musical notation format controls
 *   E0000-E0FFF           tag characters (can smuggle hidden ASCII) + variation
 *                         selectors supplement
 *
 * Deliberately NOT stripped: FE00-FE0F (variation selectors, including VS16, which
 * gives emoji their colour presentation) and ordinary combining marks — real names
 * need both. Note that 200D ZERO WIDTH JOINER *is* stripped: collapsing visually
 * identical duplicates is the point of this policy, and the cost is that a
 * multi-person ZWJ emoji sequence renders as its component emoji rather than one glyph.
 */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180B-\u180F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;

function comparable(value: string): string {
  return value.normalize("NFKD").toLowerCase()
    .replace(/[013457@$!+]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "+": "t" })[c] ?? c)
    .replace(/[^a-z]/g, "");
}

export function isFamilyFriendlyName(value: string): boolean {
  // Emptiness is judged on what actually renders, not on what survives comparable().
  // Stripping the invisibles here (rather than trusting the caller to have sanitised
  // first) keeps a name built only from zero-width or bidi characters rejected.
  if (value.replace(INVISIBLE, "").trim().length === 0) return false;

  const normalized = comparable(value);
  // comparable() projects onto [a-z], so a name written entirely in another script —
  // 龍王小明, Владимир, Αθηνά, שלום, or emoji — collapses to "". That used to be treated
  // as a rejection, which quietly renamed every such player to "Player" while
  // mixed names like "Ken 龍王" passed. An absence of Latin letters means this
  // blocklist has nothing to screen, not that the name is unsafe.
  //
  // The trade-off is explicit: BLOCKED is Latin-only, so profanity written in another
  // script is not caught. It never was — a Cyrillic homoglyph already slipped through
  // the [^a-z] strip — and screening other scripts needs a wordlist per script rather
  // than a wider net here.
  if (normalized.length === 0) return true;

  return !BLOCKED.some((word) => normalized.includes(word))
    && !BLOCKED_WHOLE_NAMES.includes(normalized as (typeof BLOCKED_WHOLE_NAMES)[number]);
}

/**
 * Split into whole code points, dropping unpaired surrogates. Iterating this way means
 * the length limit is applied in characters, so it can never cut an astral character
 * (an emoji) in half and leave a lone surrogate on the wire.
 */
function codePoints(value: string): string[] {
  const out: string[] = [];
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xd800 && code <= 0xdfff) continue; // unpaired surrogate
    out.push(ch);
  }
  return out;
}

/**
 * Canonical policy for every user-controlled player name crossing the wire.
 *
 * Order matters: strip the invisibles first (so they cannot pad a name past what the
 * limit appears to allow), trim, then clip to MAX_NAME_LENGTH code points, then trim
 * again in case the clip left a trailing space. Characters are stripped and never
 * replaced, so sanitising can only ever shorten a name.
 */
export function sanitizeDisplayName(value: unknown): string {
  const stripped = String(value ?? "").replace(INVISIBLE, "").trim();
  const clipped = codePoints(stripped).slice(0, MAX_NAME_LENGTH).join("").trim();
  return isFamilyFriendlyName(clipped) ? clipped : FALLBACK_NAME;
}
