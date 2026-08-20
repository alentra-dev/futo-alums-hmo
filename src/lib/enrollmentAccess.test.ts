import { describe, expect, it } from 'vitest';
import { subscriberEnrollment, subscriberEnrollments } from './enrollmentAccess';
import type { ProgramSnapshot } from './types';

const snapshot = {
  subscriberEnrollmentIds: ['mine'],
  enrollments: [{ id: 'other' }, { id: 'mine' }],
} as unknown as ProgramSnapshot;

describe('subscriber enrollment isolation', () => {
  it('returns only explicitly linked enrollments from an administrator-wide snapshot', () => {
    expect(subscriberEnrollments(snapshot).map((item) => item.id)).toEqual(['mine']);
    expect(subscriberEnrollment(snapshot).id).toBe('mine');
  });

  it('rejects a subscriber workspace with no linked household', () => {
    expect(() => subscriberEnrollment({ ...snapshot, subscriberEnrollmentIds: [] })).toThrow(
      'No household is linked to this account.',
    );
  });
});
