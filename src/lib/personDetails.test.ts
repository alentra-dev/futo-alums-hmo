import { describe, expect, it } from 'vitest';
import { providerContact, sharesResidence, syncDependentResidences, withPrincipalResidence } from './personDetails';
import type { Person } from './types';

const principal: Person = {
  id: 'principal', enrollmentDate: '2026-06-01', memberType: 'Member', surname: 'Doe', firstName: 'Jane', middleName: '',
  dateOfBirth: '1980-01-01', gender: 'Female', relation: 'SELF', nationality: 'Nigerian', address: '1 Main Street',
  country: 'Nigeria', state: 'Lagos', town: 'Lagos', lga: 'Ikeja', mobile: '08011111111', email: 'jane@example.com',
};
const dependent: Person = { ...principal, id: 'dependent', memberType: 'Dependent', relation: 'Husband', mobile: '', email: '' };

describe('person details', () => {
  it('copies and tracks a principal residence', () => {
    expect(sharesResidence(dependent, principal)).toBe(true);
    const moved = { ...principal, address: '2 New Street', town: 'Abuja' };
    expect(syncDependentResidences(principal, moved, [dependent])[0].address).toBe('2 New Street');
    expect(withPrincipalResidence({ ...dependent, address: 'Elsewhere' }, principal).address).toBe('1 Main Street');
  });

  it('preserves a dependent residence override', () => {
    const elsewhere = { ...dependent, address: '9 Other Road' };
    expect(syncDependentResidences(principal, { ...principal, address: '2 New Street' }, [elsewhere])[0].address).toBe('9 Other Road');
  });

  it('falls back to principal contact details for provider submission', () => {
    expect(providerContact(dependent, principal)).toEqual({ mobile: '08011111111', email: 'jane@example.com' });
    expect(providerContact({ ...dependent, mobile: '08022222222', email: 'john@example.com' }, principal))
      .toEqual({ mobile: '08022222222', email: 'john@example.com' });
  });
});
