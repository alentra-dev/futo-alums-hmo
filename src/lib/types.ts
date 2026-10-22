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
  /** Set only for members who joined after the renewal window; AVON bills fewer months. */
  proration?: EnrollmentProration | null;
  /** Balance brought forward from the household's previous-year enrollment. */
  carryIn?: CarryForward | null;
}

/** A balance carried from one coverage year into the next; positive amounts are credits. */
export interface CarryForward {
  sourceYear: number;
  creditYear: number;
  /** Verified HMO payments plus any earlier carry-in, less the subscriber total. */
  premiumBalanceKobo: number;
  /** Verified assessment payments less the one-time fee and adjustment; negative means owed. */
  assessmentBalanceKobo: number;
  prorationCreditKobo: number;
  /** HMO overpayment used to cover an assessment balance owed. */
  overpaymentAppliedKobo: number;
  netKobo: number;
}

export interface EnrollmentProration {
  /** First day of the first month AVON covers and bills, `yyyy-mm-01`. */
  coverageStartMonth: string;
  billedMonths: number;
  proratedPremiumKobo: number;
  proratedNhisKobo: number;
  /** Full premium + NHIS collected minus AVON's prorated premium + NHIS. */
  creditKobo: number;
  creditYear: number;
  /** Administrator-only reason for the recorded start month. */
  note?: string | null;
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
  assessmentId: string | null;
}

export interface PaymentAccount {
  beneficiary: string;
  bank: string;
  accountNumber: string;
  referencePrefix: string;
}

export interface FinancialAssessment {
  id: string;
  periodId: string;
  name: string;
  description: string;
  amountKobo: number;
  feePortionKobo: number;
  futureCreditKobo: number;
  creditYear: number;
  dueAt: string;
  active: boolean;
  /** Only the transfer reference is per-assessment; bank details come from the one program account. */
  referencePrefix: string;
}

export interface AssessmentAdjustment {
  assessmentId: string;
  enrollmentId: string;
  adjustmentKobo: number;
  note: string;
  /** Assignment snapshots; optional only while reading a pre-migration workspace. */
  amountKobo?: number;
  feePortionKobo?: number;
  futureCreditKobo?: number;
  creditYear?: number;
}

export interface EnrollmentPeriod {
  id: string;
  year: number;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'open' | 'closed';
  extensionNote?: string;
  nhisFeeBasisPoints: number;
  programFeeBasisPoints: number;
  /** First month of the twelve-month AVON term, `yyyy-09-01` by default. */
  coverageStartsOn?: string;
  /** Whether new subscribers may keep joining after the renewal window closes. */
  lateEnrollmentOpen?: boolean;
  /** How this period currently accepts new subscribers, if at all. */
  intakeMode?: 'regular' | 'late' | null;
  /** The coverage month an approval now would record for a late member. */
  lateCoverageStartsOn?: string | null;
  /** Whether balances from this year carry into the next (false for imported years). */
  carryForwardEnabled?: boolean;
}

export interface NewEnrolleeAssessment {
  name: string;
  amountKobo: number;
  feePortionKobo: number;
  futureCreditKobo: number;
  creditYear: number;
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

export interface ConsentRecord {
  enrollmentId: string;
  consentedAt: string;
  channel: 'portal' | 'offline';
  note: string | null;
  recordedAt: string | null;
  recordedBy: string | null;
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
  assessments: FinancialAssessment[];
  assessmentAdjustments: AssessmentAdjustment[];
  auditEvents: AuditEvent[];
  hospitalSuggestions: string[];
  consentRecords: ConsentRecord[];
}

export interface PaymentInput {
  enrollmentId: string;
  amountKobo: number;
  paidAt: string;
  assessmentId?: string;
  reference: string;
  proof?: File;
}

export type EnrollmentPeriodSnapshot = Pick<ProgramSnapshot, 'period' | 'plans' | 'enrollments' | 'payments' | 'assessments' | 'assessmentAdjustments'>;
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
  enrollmentMode?: 'regular' | 'late' | null;
  period: EnrollmentPeriod | null;
  plans: PlanOffering[];
  newEnrolleeAssessment?: NewEnrolleeAssessment | null;
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
  premiumKobo?: number | null;
  nhisFeeBasisPoints?: number;
  coverageStartsOn?: string;
  /** Set when approval now would make this a late enrollment. */
  lateCoverageStartsOn?: string | null;
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
