import { describe, expect, it } from 'vitest';
import { parseNumericInput } from './numericInput';

describe('numeric form validation', () => {
  it('distinguishes an empty draft from an explicit zero', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('  ')).toBeNull();
    expect(parseNumericInput('0', { min: 0 })).toBe(0);
  });

  it('accepts complete decimals and signed adjustments', () => {
    expect(parseNumericInput('0.50', { min: 0, max: 100 })).toBe(0.5);
    expect(parseNumericInput('-18000')).toBe(-18000);
    expect(parseNumericInput('15000.25')).toBe(15000.25);
  });

  it('rejects incomplete, nonfinite, out-of-range, and fractional year values', () => {
    for (const draft of ['-', '.', 'NaN', 'Infinity', '1e']) expect(parseNumericInput(draft)).toBeNull();
    expect(parseNumericInput('-1', { min: 0 })).toBeNull();
    expect(parseNumericInput('101', { max: 100 })).toBeNull();
    expect(parseNumericInput('2027.5', { integer: true })).toBeNull();
    expect(parseNumericInput('2027', { min: 2027, max: 2100, integer: true })).toBe(2027);
  });
});
