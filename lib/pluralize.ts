export function pluralize(count: number, word: string, customPlural?: string) {
  // 1. Format the count with native commas/decimals
  const formattedCount = new Intl.NumberFormat().format(count);

  // 2. Determine if it is singular ('one') or plural ('other')
  const rule = new Intl.PluralRules("en").select(count);

  if (rule === "one") {
    return `${formattedCount} ${word}`;
  }

  // 3. If plural, use custom override or apply standard English rules
  if (customPlural) return `${formattedCount} ${customPlural}`;
  if (word.endsWith("y") && !/[aeiou]y$/i.test(word)) return `${formattedCount} ${word.slice(0, -1)}ies`;
  if (word.endsWith("s") || word.endsWith("ch") || word.endsWith("sh") || word.endsWith("x"))
    return `${formattedCount} ${word}es`;

  return `${formattedCount} ${word}s`;
}
