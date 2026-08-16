import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const workbookPath = process.argv.find((arg) => arg.endsWith('.xlsx'));
const shouldApply = process.argv.includes('--apply');
const shouldInvite = process.argv.includes('--invite');

if (!workbookPath) throw new Error('Usage: npm run import:2025 -- /path/to/workbook.xlsx [--apply --invite]');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(workbookPath);
const sheet = workbook.getWorksheet('AVON COMPLETED TEMPLATE');
if (!sheet) throw new Error('AVON COMPLETED TEMPLATE sheet was not found.');

const headers = new Map<string, number>();
sheet.getRow(1).eachCell((cell, column) => headers.set(String(cell.value).trim(), column));
const requiredHeaders = ['MEMBER_TYPE', 'SURNAME', 'FIRST_NAME', 'MIDDLE_NAME', 'DOB(DD/MM/YYYY)', 'GENDER', 'RELATION', 'NATIONALITY', 'ENROLLMENT_DATE(DD/MM/YYYY)', 'ADDRESS_OF_RESIDENCE', 'COUNTRY_OF_RESIDENCE', 'STATE_OF_RESIDENCE', 'TOWN_OF_RESIDENCE', 'LGA_OF_RESIDENCE', 'MOBILE_NO', 'EMAIL', 'CATEGORY(FAMILY/INDIVIDUAL)', 'HOSPITAL NAME', 'PLAN TYPE', 'AVON PREMIUM', 'AVON (+ NHIS FEE)'];
for (const header of requiredHeaders) if (!headers.has(header)) throw new Error(`Required column missing: ${header}`);

function raw(row: ExcelJS.Row, header: string) {
  const value = row.getCell(headers.get(header)!).value;
  if (value && typeof value === 'object' && 'text' in value) return String(value.text).trim();
  if (value && typeof value === 'object' && 'result' in value) return String(value.result ?? '').trim();
  return String(value ?? '').trim();
}

function dateValue(row: ExcelJS.Row, header: string) {
  const value = row.getCell(headers.get(header)!).value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = raw(row, header);
  const parts = text.split(/[/-]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error(`Invalid date in row ${row.number}, column ${header}`);
  const [a, b, c] = parts;
  const year = c > 1900 ? c : a;
  const month = c > 1900 ? a : b;
  const day = c > 1900 ? b : c;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function moneyKobo(row: ExcelJS.Row, header: string) {
  const value = row.getCell(headers.get(header)!).value;
  const number = typeof value === 'number' ? value : Number(raw(row, header).replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function planCode(source: string) {
  const value = source.toUpperCase();
  if (value.includes('VITAL')) return 'PLUS';
  if (value.includes('EXECUTIVE')) return 'EXECUTIVE_PRESTIGE';
  if (value.includes('PRESTIGE PLUS')) return 'PRESTIGE_PLUS';
  if (value.includes('PREMIUM PLUS')) return 'PREMIUM_PLUS';
  if (value.includes('PRESTIGE')) return 'PRESTIGE';
  if (value.includes('PREMIUM')) return 'PREMIUM';
  if (value.includes('PLUS')) return 'PLUS';
  throw new Error(`Unknown plan label: ${source}`);
}

function personFromRow(row: ExcelJS.Row) {
  return {
    sourceRow: row.number,
    memberType: raw(row, 'MEMBER_TYPE') as 'Member' | 'Dependent',
    surname: raw(row, 'SURNAME'), firstName: raw(row, 'FIRST_NAME'), middleName: raw(row, 'MIDDLE_NAME'),
    dateOfBirth: dateValue(row, 'DOB(DD/MM/YYYY)'), gender: raw(row, 'GENDER'), relation: raw(row, 'RELATION'), nationality: raw(row, 'NATIONALITY'),
    enrollmentDate: dateValue(row, 'ENROLLMENT_DATE(DD/MM/YYYY)'), address: raw(row, 'ADDRESS_OF_RESIDENCE'), country: raw(row, 'COUNTRY_OF_RESIDENCE'), state: raw(row, 'STATE_OF_RESIDENCE'), town: raw(row, 'TOWN_OF_RESIDENCE'), lga: raw(row, 'LGA_OF_RESIDENCE'), mobile: raw(row, 'MOBILE_NO'), email: raw(row, 'EMAIL').toLowerCase(),
  };
}

type ImportedPerson = ReturnType<typeof personFromRow>;
type Household = { sourceRow: number; accountEmail: string; principal: ImportedPerson; dependents: ImportedPerson[]; category: 'individual' | 'family'; hospital: string; sourcePlan: string; normalizedPlanCode: string; premiumKobo: number; avonWithNhisKobo: number };
const households: Household[] = [];
let current: Household | null = null;

sheet.eachRow((row, number) => {
  if (number === 1) return;
  const memberType = raw(row, 'MEMBER_TYPE');
  if (memberType !== 'Member' && memberType !== 'Dependent') return;
  const person = personFromRow(row);
  if (memberType === 'Member') {
    const sourcePlan = raw(row, 'PLAN TYPE');
    current = {
      sourceRow: row.number, accountEmail: person.email, principal: person, dependents: [],
      category: raw(row, 'CATEGORY(FAMILY/INDIVIDUAL)').toLowerCase() === 'family' ? 'family' : 'individual',
      hospital: raw(row, 'HOSPITAL NAME'), sourcePlan, normalizedPlanCode: planCode(sourcePlan),
      premiumKobo: moneyKobo(row, 'AVON PREMIUM'), avonWithNhisKobo: moneyKobo(row, 'AVON (+ NHIS FEE)'),
    };
    households.push(current);
  } else {
    if (!current) throw new Error(`Dependent in row ${row.number} has no preceding principal member.`);
    current.dependents.push(person);
  }
});

const peopleCount = households.reduce((sum, household) => sum + 1 + household.dependents.length, 0);
if (peopleCount !== 43) throw new Error(`Picture inclusion check failed: expected 43 matched people, found ${peopleCount}.`);

const preview = {
  source: 'AVON Template.png inclusion set; exact values from AVON COMPLETED TEMPLATE',
  households,
  checks: {
    principals: households.length,
    dependents: households.reduce((sum, item) => sum + item.dependents.length, 0),
    totalPeople: peopleCount,
    uniqueAccountEmails: new Set(households.map((item) => item.accountEmail)).size,
    vitalLabelsNormalized: households.filter((item) => item.sourcePlan.toUpperCase().includes('VITAL')).length,
  },
};

await mkdir(resolve('.private'), { recursive: true });
await writeFile(resolve('.private/2025-import-preview.json'), JSON.stringify(preview, null, 2), { mode: 0o600 });
console.log(JSON.stringify(preview.checks));

if (!shouldApply) {
  console.log('Dry run complete. Private preview written to .private/2025-import-preview.json.');
  process.exit(0);
}
if (!shouldInvite) throw new Error('Live import requires --invite so every household can be linked to a verified account.');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply.');
const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function one<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Expected a database record.');
  return data;
}

const program = await one(supabase.from('programs').select('id').eq('slug', 'futo-alums-hmo').single());
const periods = await one(supabase.from('enrollment_periods').select('id,coverage_year').eq('program_id', program.id));
const period2025 = periods.find((item: any) => item.coverage_year === 2025);
const period2026 = periods.find((item: any) => item.coverage_year === 2026);
if (!period2025 || !period2026) throw new Error('The 2025 and 2026 periods must exist before import.');

const observed = new Map<string, { individual: number; family: number }>();
for (const item of households) {
  const rates = observed.get(item.normalizedPlanCode) ?? { individual: 0, family: 0 };
  rates[item.category] = item.premiumKobo;
  observed.set(item.normalizedPlanCode, rates);
}
const planNames: Record<string, string> = { PLUS: 'Plus Plan', PREMIUM: 'Premium Plan', PREMIUM_PLUS: 'Premium Plus', PRESTIGE: 'Prestige Plan', PRESTIGE_PLUS: 'Prestige Plus', EXECUTIVE_PRESTIGE: 'Executive Prestige' };
for (const [code, rates] of observed) {
  const { error } = await supabase.from('plan_offerings').upsert({ period_id: period2025.id, code, name: planNames[code], description: 'Historical 2025 offering', region: 'Nigeria', individual_premium_kobo: rates.individual, family_premium_kobo: rates.family, highlights: [], benefits: [], active: false }, { onConflict: 'period_id,code' });
  if (error) throw new Error(error.message);
}
const historicalPlans = await one(supabase.from('plan_offerings').select('id,code').eq('period_id', period2025.id));

async function invite(email: string, displayName: string) {
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { data: { display_name: displayName } });
  if (error && !error.message.toLowerCase().includes('already')) throw new Error(error.message);
  if (data.user) return data.user.id;
  const users = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = users.data.users.find((user) => user.email?.toLowerCase() === email);
  if (!existing) throw new Error(`Unable to locate invited user for ${email}`);
  return existing.id;
}

for (const [index, household] of households.entries()) {
  const userId = await invite(household.accountEmail, `${household.principal.firstName} ${household.principal.surname}`);
  await supabase.from('program_memberships').upsert({ program_id: program.id, user_id: userId, role: 'subscriber', active: true });
  const savedHousehold = await one(supabase.from('households').upsert({ program_id: program.id, legacy_key: `picture-set-${index + 1}` }, { onConflict: 'program_id,legacy_key' }).select('id').single());
  await supabase.from('account_households').upsert({ user_id: userId, household_id: savedHousehold.id });
  const people = [household.principal, ...household.dependents].map((person) => ({ household_id: savedHousehold.id, member_type: person.memberType, surname: person.surname, first_name: person.firstName, middle_name: person.middleName, date_of_birth: person.dateOfBirth, gender: person.gender, relation: person.relation, nationality: person.nationality, address_of_residence: person.address, country_of_residence: person.country, state_of_residence: person.state, town_of_residence: person.town, lga_of_residence: person.lga, mobile_no: person.mobile, email: person.email }));
  const { error: peopleError } = await supabase.from('people').upsert(people, { onConflict: 'id' });
  if (peopleError) throw new Error(peopleError.message);
  const plan = historicalPlans.find((item: any) => item.code === household.normalizedPlanCode);
  const nhis = Math.max(0, household.avonWithNhisKobo - household.premiumKobo);
  const reserve = Math.round(household.premiumKobo * 0.02);
  await supabase.from('enrollments').upsert({ household_id: savedHousehold.id, period_id: period2025.id, plan_offering_id: plan?.id, category: household.category, hospital_name: household.hospital, status: 'closed', enrollment_date: household.principal.enrollmentDate, premium_kobo: household.premiumKobo, nhis_fee_kobo: nhis, reserve_fee_kobo: reserve, subscriber_total_kobo: household.premiumKobo + nhis + reserve, completeness: 100, closed_at: '2025-08-31T22:59:59Z', imported_source: { sheet: 'AVON COMPLETED TEMPLATE', row: household.sourceRow, original_plan_label: household.sourcePlan, normalized_plan_code: household.normalizedPlanCode } }, { onConflict: 'household_id,period_id' });
  await supabase.from('enrollments').upsert({ household_id: savedHousehold.id, period_id: period2026.id, category: household.category, hospital_name: household.hospital, status: 'draft', enrollment_date: '2026-06-01', completeness: 80 }, { onConflict: 'household_id,period_id' });
  if (household.hospital) await supabase.from('hospital_suggestions').upsert({ program_id: program.id, name: household.hospital }, { onConflict: 'program_id,normalized_name' });
}

const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase();
const adminEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
if (!ownerEmail || !adminEmails.length) throw new Error('OWNER_EMAIL and ADMIN_EMAILS are required for live import.');
for (const email of new Set([ownerEmail, ...adminEmails])) {
  const userId = await invite(email, email.split('@')[0]);
  await supabase.from('program_memberships').upsert({ program_id: program.id, user_id: userId, role: email === ownerEmail ? 'owner' : 'admin', active: true });
}

const accountNumber = process.env.PAYMENT_ACCOUNT_NUMBER;
if (!accountNumber) throw new Error('PAYMENT_ACCOUNT_NUMBER is required for live import.');
await supabase.from('payment_accounts').upsert({ program_id: program.id, beneficiary: process.env.PAYMENT_ACCOUNT_NAME, bank: process.env.PAYMENT_BANK, account_number: accountNumber, reference_prefix: 'FUTO HMO' });
console.log('Live import complete. Invitations were sent to linked subscriber and administrator accounts.');
