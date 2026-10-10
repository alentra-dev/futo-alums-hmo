/** Parse only at validation/save time; editable inputs retain their raw text, including ''. */
export function parseNumericInput(value: string, options: { min?: number; max?: number; integer?: boolean } = {}): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || (options.integer && !Number.isSafeInteger(number))
    || (options.min !== undefined && number < options.min)
    || (options.max !== undefined && number > options.max)) return null;
  return number;
}
