import type { Enrollment, ProgramSnapshot } from './types';

export function subscriberEnrollments(snapshot: ProgramSnapshot): Enrollment[] {
  const allowed = new Set(snapshot.subscriberEnrollmentIds);
  return snapshot.enrollments.filter((enrollment) => allowed.has(enrollment.id));
}

export function subscriberEnrollment(snapshot: ProgramSnapshot, activeEnrollmentId?: string): Enrollment {
  const available = subscriberEnrollments(snapshot);
  const enrollment = available.find((item) => item.id === activeEnrollmentId) ?? available[0];
  if (!enrollment) throw new Error('No household is linked to this account.');
  return enrollment;
}

export function canActForSubscribers(snapshot: ProgramSnapshot) {
  return snapshot.profile.role === 'admin' || snapshot.profile.role === 'owner';
}

/**
 * The enrollment the subscriber screens operate on. An administrator acting for a
 * subscriber who cannot reach the portal resolves against every enrollment the snapshot
 * returned; `can_access_household` has already limited that to their own program.
 */
export function workspaceEnrollment(snapshot: ProgramSnapshot, activeEnrollmentId?: string, actingEnrollmentId?: string): Enrollment {
  if (actingEnrollmentId && canActForSubscribers(snapshot)) {
    const acting = snapshot.enrollments.find((item) => item.id === actingEnrollmentId);
    if (acting) return acting;
  }
  return subscriberEnrollment(snapshot, activeEnrollmentId);
}
