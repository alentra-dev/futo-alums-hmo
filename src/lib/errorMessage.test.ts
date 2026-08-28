import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  it('uses native Error messages', () => {
    expect(errorMessage(new Error('Enrollment period is closed'), 'Fallback')).toBe('Enrollment period is closed');
  });

  it('uses error-like API responses', () => {
    expect(errorMessage({ message: 'Plan and hospital are required' }, 'Fallback')).toBe('Plan and hospital are required');
  });

  it('falls back for an unknown error shape', () => {
    expect(errorMessage({ code: 'UNKNOWN' }, 'Unable to save')).toBe('Unable to save');
  });
});
