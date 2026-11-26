/**
 * Decide what a template switch should put in a CreateBotModal field.
 *
 * A field keeps the user's own edit: it is only overwritten when it is
 * still empty or still holds exactly what the previous template put there.
 * `previousApplied` is the value the previous template actually applied —
 * for the Blank template's description that is '' (see CreateBotModal),
 * not the Blank template's placeholder text.
 */
export function nextTemplateField(current: string, previousApplied: string | undefined, next: string): string {
  return !current.trim() || current === previousApplied ? next : current;
}
