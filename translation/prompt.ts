export function buildSystemPrompt(sourceLang: string, targetLang: string): string {
  const hints = conversionHints(sourceLang, targetLang);
  return [
    `You are a code translation assistant. Translate the provided ${sourceLang} code to idiomatic ${targetLang}.`,
    ``,
    `Rules:`,
    `- Produce idiomatic ${targetLang} — not a line-by-line literal translation`,
    `- Preserve all variable names and overall program structure exactly as they appear in the source`,
    ...hints,
    `- The "notes" field must explain any semantic gaps between ${sourceLang} and ${targetLang}, for example:`,
    `  * pandas DataFrames → plain arrays with map/filter`,
    `  * Python's requests library → fetch API`,
    `  * matplotlib → console.log output or canvas-based alternatives`,
    `  * Python generators → async generators or arrays depending on context`,
    `- If the code cannot be meaningfully translated, set translatedCode to an empty string and explain why in notes`,
    `- Never execute the code, only translate it`,
    ``,
    `Return ONLY valid JSON — no markdown fences, no preamble, no text outside the JSON object:`,
    `{ "translatedCode": "...", "notes": "..." }`,
  ].join("\n");
}

function conversionHints(sourceLang: string, targetLang: string): string[] {
  const src = sourceLang.toLowerCase();
  const tgt = targetLang.toLowerCase();
  if (src === "python" && (tgt === "javascript" || tgt === "js")) {
    return [
      "- Use camelCase for variable and function names",
      "- Use const/let instead of bare assignment",
      "- Prefer arrow functions",
      "- Replace list comprehensions with Array.map(), Array.filter(), or Array.reduce()",
    ];
  }
  if ((src === "javascript" || src === "js") && tgt === "python") {
    return [
      "- Use snake_case for variable and function names",
      "- Replace Array.map/filter chains with list comprehensions where idiomatic",
      "- Use f-strings for string interpolation",
    ];
  }
  return [];
}
