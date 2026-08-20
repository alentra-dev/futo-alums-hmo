import { describe, expect, it } from 'vitest';
import { normalizeNigerianPhone, whatsappVerificationUrl } from './duplicateMatching';

describe('duplicate review contact helpers', () => {
  it('normalizes local Nigerian numbers for WhatsApp', () => {
    expect(normalizeNigerianPhone('0803 123 4567')).toBe('2348031234567');
    expect(normalizeNigerianPhone('+234 803 123 4567')).toBe('2348031234567');
  });

  it('creates a prefilled WhatsApp verification link', () => {
    const url = whatsappVerificationUrl('08031234567');
    expect(url).toContain('https://wa.me/2348031234567');
    expect(url).toContain('FUTO%20HMO%20Program');
  });
});
