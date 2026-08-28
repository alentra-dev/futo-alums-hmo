import { describe, expect, it } from 'vitest';
import { incompletePersonMessage } from './personValidation';
import type { Person } from './types';

const completePerson: Person = {
  id: 'person-1', enrollmentDate: '2026-06-01', memberType: 'Dependent', surname: 'Doe', firstName: 'John', middleName: 'N/A',
  dateOfBirth: '1980-01-01', gender: 'Male', relation: 'Husband', nationality: 'Nigerian',
  address: '1 Main Street', country: 'Nigeria', state: 'Lagos', town: 'Lagos', lga: 'Ikeja',
  mobile: '08012345678', email: 'john@example.com',
};

describe('incompletePersonMessage', () => {
  it('accepts a complete dependent', () => {
    expect(incompletePersonMessage(completePerson, 'Dependent 5')).toBeNull();
  });

  it('identifies missing fields and explains the middle-name fallback', () => {
    expect(incompletePersonMessage({ ...completePerson, middleName: '', mobile: '' }, 'Dependent 5'))
      .toBe('Dependent 5: complete middle name (enter N/A if none), mobile number.');
  });
});
