/* Aurora — command palette matching: every typed word must start a word of the command. */

export function matchCommand(cmd, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${cmd.label} ${cmd.group} ${cmd.keywords || ''}`.toLowerCase().split(/[^a-z0-9]+/);
  return words.every((w) => hay.some((h) => h.startsWith(w)));
}
