import type { Enrollment, ProgramSnapshot } from './types';

export function subscriberEnrollments(snapshot: ProgramSnapshot): Enrollment[] {
  const allowed = new Set(snapshot.subscriberEnrollmentIds);
  return snapshot.enrollments.filter((enrollment) => allowed.has(enrollment.id));
}

export function subscriberEnrollment(snapshot: ProgramSnapshot): Enrollment {
  const enrollment = subscriberEnrollments(snapshot)[0];
  if (!enrollment) throw new Error('No household is linked to this account.');
  return enrollment;
}
