import type { ProgramSnapshot } from './types';
import { assessmentForEnrollment, enrollmentFinancialPosition } from './financialPosition';
import { calculateFees } from './money';
import { surchargeRates } from './surchargeRates';
import { fullName } from './format';
import { providerContact } from './personDetails';

function saveBuffer(buffer: ArrayBuffer, name: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

export const adminFullExportColumns = [
  'Timestamp', 'SNO', 'MEMBER_TYPE', 'SURNAME', 'FIRST_NAME', 'MIDDLE_NAME', 'DOB(DD/MM/YYYY)', 'GENDER', 'RELATION', 'NATIONALITY',
  'STAFF_NO (LEAVE THIS BLANK)', 'ENROLLEE_ID (LEAVE THIS BLANK)', 'ENROLLMENT_DATE(DD/MM/YYYY)', 'ADDRESS_OF_RESIDENCE',
  'COUNTRY_OF_RESIDENCE', 'STATE_OF_RESIDENCE', 'TOWN_OF_RESIDENCE', 'LGA_OF_RESIDENCE', 'MOBILE_NO', 'EMAIL',
  'CATEGORY(FAMILY/INDIVIDUAL)', 'HOSPITAL NAME', 'PLAN TYPE', 'CLIENT NAME', 'FUTO HMO FULL PAYMNT', 'AVON PREMIUM', 'AVON (+ NHIS FEE)', 'AVON BALANCE',
  'HMO PAYMENT POSITION', 'HMO UNDERPAYMENT', 'HMO OVERPAYMENT', 'PROGRAM ASSESSMENT', 'ASSESSMENT PAID', 'ASSESSMENT NET DUE', 'FUTURE ENROLLMENT CREDIT',
];

const internalColumns = new Set(['FUTO HMO FULL PAYMNT', 'HMO PAYMENT POSITION', 'HMO UNDERPAYMENT', 'HMO OVERPAYMENT', 'PROGRAM ASSESSMENT', 'ASSESSMENT PAID', 'ASSESSMENT NET DUE', 'FUTURE ENROLLMENT CREDIT']);
export const avonExportColumns = adminFullExportColumns.filter((column) => !internalColumns.has(column));

export type EnrollmentExportKind = 'avon' | 'admin';

function dateForAvon(value: string) {
  const [year, month, day] = (value ?? '').slice(0, 10).split('-');
  // A missing or malformed date must leave the provider cell blank rather than emit "undefined/undefined/".
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

export async function createEnrollmentWorkbook(snapshot: ProgramSnapshot, kind: EnrollmentExportKind) {
  const adminFull = kind === 'admin';
  const columns = adminFull ? adminFullExportColumns : avonExportColumns;
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FUTO Alums HMO Program';
  const sheet = workbook.addWorksheet(adminFull ? 'ADMIN FULL EXPORT' : 'AVON COMPLETED TEMPLATE', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(columns);
  let serial = 1;
  for (const enrollment of snapshot.enrollments) {
    if (!adminFull && !['submitted', 'closed'].includes(enrollment.status)) continue;
    const plan = snapshot.plans.find((item) => item.id === enrollment.planId);
    if (!plan) continue;
    const premiumKobo = enrollment.category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
    const fees = calculateFees(premiumKobo, surchargeRates(snapshot.period));
    const verified = snapshot.payments.filter((item) => item.enrollmentId === enrollment.id && item.status === 'verified' && !item.assessmentId).reduce((sum, item) => sum + item.amountKobo, 0);
    const assigned = assessmentForEnrollment(enrollment.id, snapshot.assessments, snapshot.assessmentAdjustments);
    const financial = enrollmentFinancialPosition(enrollment, snapshot.payments, assigned.assessment, assigned.adjustment);
    for (const [index, person] of [enrollment.principal, ...enrollment.dependents].entries()) {
      const contact = adminFull ? { mobile: person.mobile, email: person.email } : providerContact(person, enrollment.principal);
      const row = [
        new Date().toISOString(), serial++, person.memberType, person.surname.toUpperCase(), person.firstName.toUpperCase(), person.middleName.toUpperCase(),
        dateForAvon(person.dateOfBirth), person.gender, person.relation, person.nationality, '', '', dateForAvon(person.enrollmentDate), person.address,
        person.country, person.state, person.town, person.lga, contact.mobile, contact.email, enrollment.category.toUpperCase(), enrollment.hospital,
        `${plan.name.toUpperCase()} (${enrollment.category.toUpperCase()})`, 'FUTO Alumni HMO',
        index === 0 ? verified / 100 : '', index === 0 ? premiumKobo / 100 : '', index === 0 ? (premiumKobo + fees.nhisFeeKobo) / 100 : '',
        index === 0 ? Math.max(0, premiumKobo + fees.nhisFeeKobo - verified) / 100 : '',
        index === 0 ? financial.premium.status : '', index === 0 ? financial.premium.underpaymentKobo / 100 : '', index === 0 ? financial.premium.overpaymentKobo / 100 : '',
        index === 0 && assigned.assessment ? assigned.assessment.name : '', index === 0 ? financial.assessmentPaidKobo / 100 : '', index === 0 ? financial.assessmentDueKobo / 100 : '', index === 0 && assigned.assessment ? assigned.assessment.futureCreditKobo / 100 : '',
      ];
      sheet.addRow(adminFull ? row : row.filter((_value, columnIndex) => !internalColumns.has(adminFullExportColumns[columnIndex])));
    }
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12372A' } };
  header.height = 34;
  sheet.columns.forEach((column, index) => { column.width = index >= 13 && index <= 22 ? 24 : 18; });
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(columns.length).letter}1` };
  const currencyColumns = adminFull ? [25, 26, 27, 28, 30, 31, 33, 34, 35] : [25, 26, 27];
  currencyColumns.forEach((column) => { sheet.getColumn(column).numFmt = '₦#,##0.00'; });
  return workbook.xlsx.writeBuffer();
}

async function downloadEnrollmentWorkbook(snapshot: ProgramSnapshot, kind: EnrollmentExportKind) {
  const buffer = await createEnrollmentWorkbook(snapshot, kind);
  const label = kind === 'admin' ? 'Admin-Full' : 'AVON';
  saveBuffer(buffer as ArrayBuffer, 'FUTO-HMO-' + label + '-' + snapshot.period.year + '.xlsx');
}

export function downloadAvonWorkbook(snapshot: ProgramSnapshot) {
  return downloadEnrollmentWorkbook(snapshot, 'avon');
}

export function downloadAdminFullWorkbook(snapshot: ProgramSnapshot) {
  return downloadEnrollmentWorkbook(snapshot, 'admin');
}

export async function downloadSummaryWorkbook(snapshot: ProgramSnapshot) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${snapshot.period.year} Summary`, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'Member name', key: 'name', width: 28 },
    { header: 'Plan', key: 'plan', width: 24 },
    { header: 'Category', key: 'category', width: 14 },
    { header: 'Amount owed', key: 'owed', width: 18 },
    { header: 'Verified paid', key: 'paid', width: 18 },
    { header: 'Pending review', key: 'pending', width: 18 },
    { header: 'Outstanding', key: 'outstanding', width: 18 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Payment position', key: 'paymentPosition', width: 18 },
    { header: 'Underpayment', key: 'underpayment', width: 18 },
    { header: 'Overpayment', key: 'overpayment', width: 18 },
    { header: 'Assessment', key: 'assessment', width: 28 },
    { header: 'Assessment paid', key: 'assessmentPaid', width: 18 },
    { header: 'Assessment net due', key: 'assessmentDue', width: 18 },
    { header: 'Future credit', key: 'futureCredit', width: 18 },
  ];
  for (const enrollment of snapshot.enrollments) {
    const plan = snapshot.plans.find((item) => item.id === enrollment.planId);
    const related = snapshot.payments.filter((item) => item.enrollmentId === enrollment.id);
    const pending = related.filter((item) => item.status === 'pending' && !item.assessmentId).reduce((sum, item) => sum + item.amountKobo, 0);
    const assigned = assessmentForEnrollment(enrollment.id, snapshot.assessments, snapshot.assessmentAdjustments);
    const financial = enrollmentFinancialPosition(enrollment, snapshot.payments, assigned.assessment, assigned.adjustment);
    sheet.addRow({ name: fullName(enrollment.principal), plan: plan?.name ?? 'Not selected', category: enrollment.category, owed: enrollment.totalKobo / 100, paid: financial.premiumPaidKobo / 100, pending: pending / 100, outstanding: financial.premium.underpaymentKobo / 100, status: enrollment.status, paymentPosition: financial.premium.status, underpayment: financial.premium.underpaymentKobo / 100, overpayment: financial.premium.overpaymentKobo / 100, assessment: assigned.assessment?.name ?? '', assessmentPaid: financial.assessmentPaidKobo / 100, assessmentDue: financial.assessmentDueKobo / 100, futureCredit: assigned.assessment?.futureCreditKobo ? assigned.assessment.futureCreditKobo / 100 : '' });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12372A' } };
  ['D', 'E', 'F', 'G', 'J', 'K', 'M', 'N', 'O'].forEach((column) => { sheet.getColumn(column).numFmt = '₦#,##0.00'; });
  sheet.autoFilter = { from: 'A1', to: 'O1' };
  const buffer = await workbook.xlsx.writeBuffer();
  saveBuffer(buffer as ArrayBuffer, `FUTO-HMO-Summary-${snapshot.period.year}.xlsx`);
}
