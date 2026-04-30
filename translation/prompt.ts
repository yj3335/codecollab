/**
 * TODO Week 2 — Gemini system prompt requirements:
 *
 * The prompt must instruct Gemini to:
 *  1. Produce idiomatic target-language code, not a line-by-line literal
 *     translation. E.g. Python list comprehensions → JS Array.map(), not a for-loop.
 *  2. Preserve all variable and function names exactly as they appear in the
 *     source, unless a name is a reserved keyword in the target language
 *     (in which case suffix with an underscore, e.g. `class` → `class_`).
 *  3. Populate the `notes` response field with a human-readable explanation of
 *     any semantic gaps between the source and target languages — e.g. Python
 *     generators have no direct JS equivalent; note that async generators were
 *     used instead.
 *  4. Wrap the translated code in a markdown fence tagged with the target
 *     language for easy extraction by the response parser.
 *  5. If the source snippet references standard-library functions that do not
 *     exist in the target language, substitute the closest equivalent and note
 *     it in the `notes` field.
 */
export function buildSystemPrompt(
  sourceLang: string,
  targetLang: string
): string {
  // TODO Week 2: replace with real Gemini prompt template
  return `TODO: build prompt for ${sourceLang} → ${targetLang} translation`;
}
