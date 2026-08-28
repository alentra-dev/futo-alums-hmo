import { describe, expect, it } from 'vitest';
import { incompletePersonMessage } from './personValidation';
import type { Person } from './types';

const completeDependent: Person = {
  id: 'person-1', enrollmentDate: '2026-06-01', memberType: 'Dependent', surname: 'Doe', firstName: 'John', middleName: '',
  dateOfBirth: '1980-01-01', gender: 'Male', relation: 'Husband', nationality: 'Nigerian',
  address: '1 Main Street', country: 'Nigeria', state: 'Lagos', town: 'Lagos', lga: 'Ikeja', mobile: '', email: '',
};

describe('incompletePersonMessage', () => {
  it('accepts optional middle name and dependent contact details', () => {
    expect(incompletePersonMessage(completeDependent, 'Dependent 5')).toBeNull();
  });

  it('requires principal contact details', () => {
    expect(incompletePersonMessage({ ...completeDependent, memberType: 'Member' }, 'Principal member'))
      .toBe('Principal member: complete mobile number, email.');
  });

  it('validates optional contact details when provided', () => {
    expect(incompletePersonMessage({ ...completeDependent, mobile: '123', email: 'invalid' }, 'Dependent 5'))
      .toBe('Dependent 5: enter a valid mobile number.');
  });

  it('still requires complete residence details', () => {
    expect(incompletePersonMessage({ ...completeDependent, lga: '' }, 'Dependent 5'))
      .toBe('Dependent 5: complete LGA.');
  });
});
