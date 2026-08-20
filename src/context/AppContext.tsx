/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { demoSnapshot } from '../data/demo';
import { fullName } from '../lib/format';
import { planTotalKobo } from '../lib/money';
import { isDemoMode, supabase } from '../lib/supabase';
import type { Enrollment, EnrollmentPeriod, Payment, PaymentAccount, PaymentInput, PaymentStatus, PlanCategory, ProgramSnapshot, Role } from '../lib/types';

interface AppContextValue {
  snapshot: ProgramSnapshot | null;
  loading: boolean;
  authenticated: boolean;
  demoMode: boolean;
  notice: string | null;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  setDemoRole: (role: Role) => void;
  dismissNotice: () => void;
  selectPlan: (enrollmentId: string, planId: string, category: PlanCategory) => Promise<void>;
  updateEnrollment: (enrollmentId: string, changes: Partial<Enrollment>) => Promise<void>;
  submitPayment: (input: PaymentInput) => Promise<void>;
  reviewPayment: (paymentId: string, status: Exclude<PaymentStatus, 'pending'>) => Promise<void>;
  updatePeriod: (changes: Partial<EnrollmentPeriod>) => Promise<void>;
  updatePaymentAccount: (account: PaymentAccount) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function mapSnapshot(payload: unknown): ProgramSnapshot {
  return payload as ProgramSnapshot;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<ProgramSnapshot | null>(isDemoMode ? demoSnapshot : null);
  const [authenticated, setAuthenticated] = useState(isDemoMode);
  const [loading, setLoading] = useState(!isDemoMode);
  const [notice, setNotice] = useState<string | null>(null);

  const loadLiveSnapshot = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [snapshotResult, enrollmentIdsResult] = await Promise.all([
      supabase.rpc('get_portal_snapshot'),
      supabase.rpc('get_subscriber_enrollment_ids'),
    ]);
    const error = snapshotResult.error ?? enrollmentIdsResult.error;
    if (error) {
      setNotice(error.message);
      setSnapshot(null);
    } else {
      setSnapshot({
        ...mapSnapshot(snapshotResult.data),
        subscriberEnrollmentIds: (enrollmentIdsResult.data ?? []) as string[],
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isDemoMode || !supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const hasSession = Boolean(data.session);
      setAuthenticated(hasSession);
      if (hasSession) void loadLiveSnapshot();
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(Boolean(session));
      if (session) void loadLiveSnapshot();
      else setSnapshot(null);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadLiveSnapshot]);

  const signIn = async (email: string) => {
    if (isDemoMode) {
      setAuthenticated(true);
      setSnapshot({ ...demoSnapshot, profile: { ...demoSnapshot.profile, email } });
      return;
    }
    if (!supabase) throw new Error('Authentication is not configured.');
    const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
    setNotice('Check your email for a secure sign-in link.');
  };

  const signOut = async () => {
    if (!isDemoMode && supabase) await supabase.auth.signOut();
    setAuthenticated(false);
    if (!isDemoMode) setSnapshot(null);
  };

  const mutateDemo = (fn: (current: ProgramSnapshot) => ProgramSnapshot) => {
    if (!snapshot) return;
    setSnapshot(fn(snapshot));
  };

  const setDemoRole = (role: Role) => {
    if (!isDemoMode) return;
    mutateDemo((current) => ({ ...current, profile: { ...current.profile, role } }));
  };

  const selectPlan = async (enrollmentId: string, planId: string, category: PlanCategory) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('select_enrollment_plan', { p_enrollment_id: enrollmentId, p_plan_id: planId, p_category: category });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({
      ...current,
      enrollments: current.enrollments.map((enrollment) => {
        if (enrollment.id !== enrollmentId) return enrollment;
        const plan = current.plans.find((item) => item.id === planId);
        if (!plan) return enrollment;
        const premium = category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
        return { ...enrollment, planId, category, totalKobo: planTotalKobo(premium), status: 'draft' };
      }),
    }));
    setNotice('Plan selection updated.');
  };

  const updateEnrollment = async (enrollmentId: string, changes: Partial<Enrollment>) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('update_enrollment_details', { p_enrollment_id: enrollmentId, p_changes: changes });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({
      ...current,
      enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, ...changes } : item),
    }));
    setNotice('Enrollment details saved.');
  };

  const submitPayment = async (input: PaymentInput) => {
    if (!isDemoMode && supabase) {
      let proofPath: string | null = null;
      if (input.proof) {
        const extension = input.proof.name.split('.').pop()?.toLowerCase() ?? 'bin';
        proofPath = `${input.enrollmentId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from('payment-proofs').upload(proofPath, input.proof, { upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await supabase.rpc('submit_payment', {
        p_enrollment_id: input.enrollmentId,
        p_amount_kobo: input.amountKobo,
        p_paid_at: input.paidAt,
        p_reference: input.reference,
        p_proof_path: proofPath,
      });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    const enrollment = snapshot?.enrollments.find((item) => item.id === input.enrollmentId);
    const payment: Payment = {
      id: crypto.randomUUID(),
      enrollmentId: input.enrollmentId,
      principalName: enrollment ? fullName(enrollment.principal) : 'Subscriber',
      amountKobo: input.amountKobo,
      paidAt: input.paidAt,
      reference: input.reference,
      proofName: input.proof?.name ?? 'payment-proof.pdf',
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    mutateDemo((current) => ({ ...current, payments: [payment, ...current.payments] }));
    setNotice('Payment submitted for administrator verification.');
  };

  const reviewPayment = async (paymentId: string, status: Exclude<PaymentStatus, 'pending'>) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('review_payment', { p_payment_id: paymentId, p_status: status });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({ ...current, payments: current.payments.map((item) => item.id === paymentId ? { ...item, status } : item) }));
    setNotice(status === 'verified' ? 'Payment verified.' : 'Payment rejected.');
  };

  const updatePeriod = async (changes: Partial<EnrollmentPeriod>) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('update_enrollment_period', { p_changes: changes });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({ ...current, period: { ...current.period, ...changes } }));
    setNotice('Enrollment period updated.');
  };

  const updatePaymentAccount = async (account: PaymentAccount) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('update_payment_account', { p_account: account });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({ ...current, paymentAccount: account }));
    setNotice('Payment account updated.');
  };

  const value: AppContextValue = {
    snapshot,
    loading,
    authenticated,
    demoMode: isDemoMode,
    notice,
    signIn,
    signOut,
    setDemoRole,
    dismissNotice: () => setNotice(null),
    selectPlan,
    updateEnrollment,
    submitPayment,
    reviewPayment,
    updatePeriod,
    updatePaymentAccount,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
