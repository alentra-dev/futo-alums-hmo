export type Role = 'subscriber' | 'admin' | 'owner';
export type EnrollmentStatus = 'draft' | 'ready' | 'submitted' | 'closed';
export type PaymentStatus = 'pending' | 'verified' | 'rejected';
export type PlanCategory = 'individual' | 'family';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export interface Person {
  id: string;
  memberType: 'Member' | 'Dependent';
  surname: string;
  firstName: string;
  middleName: string;
  dateOfBirth: string;
  gender: 'Male' | 'Female';
  relation: string;
  nationality: string;
  enrollmentDate: string;
  address: string;
  country: string;
  state: string;
  town: string;
  lga: string;
  mobile: string;
  email: string;
}

export interface PlanBenefit {
  label: string;
  value: string;
}

export interface PlanOffering {
  id: string;
  code: string;
  name: string;
  description: string;
  region: string;
  individualPremiumKobo: number;
  familyPremiumKobo: number;
  highlights: string[];
  benefits: PlanBenefit[];
  active: boolean;
}

export interface Enrollment {
  id: string;
  year: number;
  principal: Person;
  dependents: Person[];
  planId: string | null;
  category: PlanCategory;
  hospital: string;
  status: EnrollmentStatus;
  totalKobo: number;
  consentedAt: string | null;
  completeness: number;
}

export interface Payment {
  id: string;
  enrollmentId: string;
  principalName: string;
  amountKobo: number;
  paidAt: string;
  reference: string;
  proofName: string;
  status: PaymentStatus;
  submittedAt: string;
}

export interface PaymentAccount {
  beneficiary: string;
  bank: string;
  accountNumber: string;
  referencePrefix: string;
}

export interface EnrollmentPeriod {
  id: string;
  year: number;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'open' | 'closed';
  extensionNote?: string;
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: string;
  summary: string;
}

export interface ProgramInfo {
  name: string;
  timezone: string;
}

export interface ProgramSnapshot {
  program: ProgramInfo;
  profile: UserProfile;
  subscriberEnrollmentIds: string[];
  period: EnrollmentPeriod;
  plans: PlanOffering[];
  enrollments: Enrollment[];
  payments: Payment[];
  paymentAccount: PaymentAccount;
  auditEvents: AuditEvent[];
  hospitalSuggestions: string[];
}

export interface PaymentInput {
  enrollmentId: string;
  amountKobo: number;
  paidAt: string;
  reference: string;
  proof?: File;
}

export type EnrollmentPeriodSnapshot = Pick<ProgramSnapshot, 'period' | 'plans' | 'enrollments' | 'payments'>;
export type SubscriberApplicationStatus = 'draft' | 'pending_review' | 'request_changes' | 'approved' | 'rejected';
export type DuplicateReviewStatus = 'unchecked' | 'clear' | 'review_required' | 'resolved' | 'confirmed_duplicate';

export interface SubscriberApplication {
  id: string;
  periodId: string;
  year: number;
  status: SubscriberApplicationStatus;
  graduationYear: number;
  principal: Person;
  dependents: Person[];
  planId: string | null;
  category: PlanCategory;
  hospital: string;
  consentedAt: string | null;
  duplicateStatus: DuplicateReviewStatus;
  adminNote: string | null;
  enrollmentId: string | null;
  submittedAt: string | null;
  createdAt: string;
}

export interface JoinConfig {
  timezone: string;
  acceptingApplications: boolean;
  period: EnrollmentPeriod | null;
  plans: PlanOffering[];
}

export interface JoinWorkspace {
  email: string;
  accountHasMembership: boolean;
  applications: SubscriberApplication[];
}

export interface DuplicateCandidate {
  id: string;
  confidence: 'likely' | 'possible';
  signals: string[];
  status: 'open' | 'distinct' | 'duplicate';
  personId: string;
  name: string;
  dateOfBirth: string;
  mobile: string;
  email: string;
  managedBy: string;
}

export interface AdminSubscriberApplication extends SubscriberApplication {
  planName: string;
  accountEmail: string;
  candidates: DuplicateCandidate[];
}

export interface PortalActivityDay {
  date: string;
  uniqueAccounts: number;
  subscriberLinked: number;
  adminOnly: number;
  applicants: number;
}

export interface PortalActivityAccount {
  userId: string;
  displayName: string;
  email: string;
  accessType: 'subscriber_linked' | 'admin_only' | 'applicant';
  activeDays: number;
  lastActiveDate: string;
  lastSeenAt: string;
}

export interface PortalActivityReport {
  timezone: string;
  today: string;
  todayUnique: number;
  last7DaysUnique: number;
  last30DaysUnique: number;
  returningAccounts: number;
  daily: PortalActivityDay[];
  recentAccounts: PortalActivityAccount[];
}
