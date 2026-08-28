/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { demoSnapshot } from '../data/demo';
import { authCallbackError, buildFreshAuthUrl, buildMagicLinkRedirect, hasAuthCallback } from '../lib/authCallback';
import { fullName } from '../lib/format';
import { planTotalKobo, type SurchargeRates } from '../lib/money';
import { isDemoMode, supabase } from '../lib/supabase';
import { loadSurchargeRates, surchargeRates, withSurchargeRates } from '../lib/surchargeRates';
import type { Enrollment, EnrollmentPeriod, Payment, PaymentAccount, PaymentInput, PaymentStatus, PlanCategory, ProgramSnapshot, Role } from '../lib/types';

interface AppContextValue {
  snapshot: ProgramSnapshot | null;
  loading: boolean;
  activeEnrollmentId: string;
  setActiveEnrollmentId: (enrollmentId: string) => void;
  authenticated: boolean;
  demoMode: boolean;
  notice: string | null;
  authError: string | null;
  signIn: (email: string) => Promise<void>;
  register: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  setDemoRole: (role: Role) => void;
  dismissNotice: () => void;
  selectPlan: (enrollmentId: string, planId: string, category: PlanCategory) => Promise<void>;
  updateEnrollment: (enrollmentId: string, changes: Partial<Enrollment>) => Promise<void>;
  submitPayment: (input: PaymentInput) => Promise<void>;
  reviewPayment: (paymentId: string, status: Exclude<PaymentStatus, 'pending'>) => Promise<void>;
  updatePeriod: (changes: Partial<EnrollmentPeriod>) => Promise<void>;
  updatePaymentAccount: (account: PaymentAccount) => Promise<void>;
  updateProgramTimezone: (timezone: string) => Promise<void>;
  updateSurchargeRates: (rates: SurchargeRates) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

function mapSnapshot(payload: unknown): ProgramSnapshot {
  return payload as ProgramSnapshot;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const initialUrl = useRef(new URL(window.location.href));
  const authCallbackPending = useRef(!isDemoMode && hasAuthCallback(initialUrl.current));
  const [snapshot, setSnapshot] = useState<ProgramSnapshot | null>(isDemoMode ? demoSnapshot : null);
  const [activeEnrollmentId, setActiveEnrollmentIdState] = useState(() => localStorage.getItem('futo-hmo-active-enrollment') ?? '');
  const [authenticated, setAuthenticated] = useState(isDemoMode);
  const [loading, setLoading] = useState(!isDemoMode);
  const [notice, setNotice] = useState<string | null>(null);

  const [authError, setAuthError] = useState<string | null>(isDemoMode ? null : authCallbackError(initialUrl.current));
  const loadLiveSnapshot = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const [snapshotResult, enrollmentIdsResult] = await Promise.all([
      supabase.rpc('get_portal_snapshot'),
      supabase.rpc('get_subscriber_enrollment_ids'),
    ]);
    const error = snapshotResult.error ?? enrollmentIdsResult.error;
    if (error) {
      if (error.message !== 'No active program membership') setNotice(error.message);
      setSnapshot(null);
    } else {
      const mapped = mapSnapshot(snapshotResult.data);
      try {
        const rates = await loadSurchargeRates(mapped.period.id);
        setNotice(null);
        setSnapshot({
          ...mapped,
          period: withSurchargeRates(mapped.period, rates),
          subscriberEnrollmentIds: (enrollmentIdsResult.data ?? []) as string[],
        });
      } catch (reason) {
        setNotice(reason instanceof Error ? reason.message : 'Unable to load surcharge rates.');
        setSnapshot(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const ids = snapshot?.subscriberEnrollmentIds ?? [];
    if (!ids.length || ids.includes(activeEnrollmentId)) return;
    localStorage.setItem('futo-hmo-active-enrollment', ids[0]);
    setActiveEnrollmentIdState(ids[0]);
  }, [snapshot, activeEnrollmentId]);

  const setActiveEnrollmentId = (enrollmentId: string) => {
    localStorage.setItem('futo-hmo-active-enrollment', enrollmentId);
    setActiveEnrollmentIdState(enrollmentId);
  };

  useEffect(() => {
    if (isDemoMode || !supabase) return;
    let active = true;
    let loadTimer: ReturnType<typeof setTimeout> | undefined;

    const handleSession = (hasSession: boolean) => {
      if (!active) return;
      setAuthenticated(hasSession);
      if (!hasSession) {
        setSnapshot(null);
        setLoading(false);
        return;
      }
      // The database collapses repeated portal loads into one account activity record per local day.
      void supabase?.rpc('record_portal_sign_in');
      if (authCallbackPending.current) {
        authCallbackPending.current = false;
        window.location.replace(buildFreshAuthUrl(initialUrl.current));
        return;
      }
      // Supabase advises keeping async work outside the auth-state callback.
      loadTimer = setTimeout(() => void loadLiveSnapshot(), 0);
    };

    supabase.auth.getSession().then(({ data }) => {
      handleSession(Boolean(data.session));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(Boolean(session));
    });
    return () => {
      active = false;
      if (loadTimer) clearTimeout(loadTimer);
      listener.subscription.unsubscribe();
    };
  }, [loadLiveSnapshot]);

  const signIn = async (email: string) => {
    setAuthError(null);
    setNotice(null);
    if (isDemoMode) {
      setAuthenticated(true);
      setSnapshot({ ...demoSnapshot, profile: { ...demoSnapshot.profile, email } });
      return;
    }
    if (!supabase) throw new Error('Authentication is not configured.');
    const redirectTo = buildMagicLinkRedirect(window.location.origin, import.meta.env.BASE_URL);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
    setNotice('Check your email for a secure sign-in link.');
  };
  const register = async (email: string) => {
    setAuthError(null);
    setNotice(null);
    if (isDemoMode) {
      setAuthenticated(true);
      return;
    }
    if (!supabase) throw new Error('Authentication is not configured.');
    // The root path is served directly by GitHub Pages. After authentication,
    // accounts without a membership are routed to the new-subscriber workspace.
    const redirectTo = buildMagicLinkRedirect(window.location.origin, import.meta.env.BASE_URL);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
    });
    if (error) throw error;
    setNotice('Check your email for a secure link to continue your application.');
  };

  const signOut = async () => {
    if (!isDemoMode && supabase) await supabase.auth.signOut();
    setAuthError(null);
    setNotice(null);
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
        return { ...enrollment, planId, category, totalKobo: planTotalKobo(premium, surchargeRates(current.period)), status: 'draft' };
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

  const updateProgramTimezone = async (timezone: string) => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('update_program_settings', { p_changes: { timezone } });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({ ...current, program: { ...current.program, timezone } }));
    setNotice('Program time zone updated.');
  };

  const updateSurchargeRates = async (rates: SurchargeRates) => {
    if (!snapshot) return;
    if (!isDemoMode && supabase) {
      const { error } = await supabase.rpc('update_enrollment_surcharge_rates', {
        p_period_id: snapshot.period.id,
        p_nhis_basis_points: rates.nhisFeeBasisPoints,
        p_program_basis_points: rates.programFeeBasisPoints,
      });
      if (error) throw error;
      await loadLiveSnapshot();
      return;
    }
    mutateDemo((current) => ({
      ...current,
      period: { ...current.period, ...rates },
      enrollments: current.enrollments.map((enrollment) => {
        const plan = current.plans.find((item) => item.id === enrollment.planId);
        if (!plan) return enrollment;
        const premium = enrollment.category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
        return { ...enrollment, totalKobo: planTotalKobo(premium, rates) };
      }),
    }));
    setNotice('Surcharge rates and enrollment totals updated.');
  };

  const value: AppContextValue = {
    snapshot,
    activeEnrollmentId,
    setActiveEnrollmentId,
    loading,
    authenticated,
    demoMode: isDemoMode,
    notice,
    signIn,
    signOut,
    setDemoRole,
    register,
    dismissNotice: () => setNotice(null),
    selectPlan,
    authError,
    updateEnrollment,
    submitPayment,
    reviewPayment,
    updatePeriod,
    updatePaymentAccount,
    updateProgramTimezone,
    updateSurchargeRates,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
