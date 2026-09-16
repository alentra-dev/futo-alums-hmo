import { describe, expect, it } from 'vitest';
import { subscriberEnrollment, subscriberEnrollments, workspaceEnrollment } from './enrollmentAccess';
import type { ProgramSnapshot } from './types';

const snapshot = {
  subscriberEnrollmentIds: ['mine'],
  enrollments: [{ id: 'other' }, { id: 'mine' }],
  profile: { role: 'subscriber' },
} as unknown as ProgramSnapshot;

describe('subscriber enrollment isolation', () => {
  it('returns only explicitly linked enrollments from an administrator-wide snapshot', () => {
    expect(subscriberEnrollments(snapshot).map((item) => item.id)).toEqual(['mine']);
    expect(subscriberEnrollment(snapshot).id).toBe('mine');
  });

  it('selects the requested principal when one account manages multiple households', () => {
    const multiple = { ...snapshot, subscriberEnrollmentIds: ['mine', 'second'], enrollments: [...snapshot.enrollments, { id: 'second' }] } as ProgramSnapshot;
    expect(subscriberEnrollment(multiple, 'second').id).toBe('second');
  });

  it('rejects a subscriber workspace with no linked household', () => {
    expect(() => subscriberEnrollment({ ...snapshot, subscriberEnrollmentIds: [] })).toThrow(
      'No household is linked to this account.',
    );
  });
});

describe('administrator acting for a subscriber', () => {
  const admin = { ...snapshot, profile: { role: 'admin' } } as unknown as ProgramSnapshot;

  it('opens the chosen subscriber workspace even with no household of their own', () => {
    const adminOnly = { ...admin, subscriberEnrollmentIds: [] } as ProgramSnapshot;
    expect(workspaceEnrollment(adminOnly, '', 'other').id).toBe('other');
  });

  it('prefers the acting subscriber over the administrator\'s own household', () => {
    expect(workspaceEnrollment(admin, 'mine', 'other').id).toBe('other');
  });

  it('never lets a subscriber reach another household by supplying an acting id', () => {
    expect(workspaceEnrollment(snapshot, 'mine', 'other').id).toBe('mine');
    expect(() => workspaceEnrollment({ ...snapshot, subscriberEnrollmentIds: [] }, '', 'other')).toThrow(
      'No household is linked to this account.',
    );
  });

  it('falls back to the own workspace when the acting enrollment is not in the snapshot', () => {
    expect(workspaceEnrollment(admin, 'mine', 'missing').id).toBe('mine');
  });
});
