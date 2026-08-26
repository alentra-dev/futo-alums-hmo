import type { ProgramSnapshot } from './types';
import { calculateFees } from './money';
import { surchargeRates } from './surchargeRates';
import { fullName } from './format';

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
];

export const avonExportColumns = adminFullExportColumns.filter((column) => column !== 'FUTO HMO FULL PAYMNT');

export type EnrollmentExportKind = 'avon' | 'admin';

function dateForAvon(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
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
    const verified = snapshot.payments.filter((item) => item.enrollmentId === enrollment.id && item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
    for (const [index, person] of [enrollment.principal, ...enrollment.dependents].entries()) {
      const row = [
        new Date().toISOString(), serial++, person.memberType, person.surname.toUpperCase(), person.firstName.toUpperCase(), person.middleName.toUpperCase(),
        dateForAvon(person.dateOfBirth), person.gender, person.relation, person.nationality, '', '', dateForAvon(person.enrollmentDate), person.address,
        person.country, person.state, person.town, person.lga, person.mobile, person.email, enrollment.category.toUpperCase(), enrollment.hospital,
        `${plan.name.toUpperCase()} (${enrollment.category.toUpperCase()})`, 'FUTO Alumni HMO',
        index === 0 ? verified / 100 : '', index === 0 ? premiumKobo / 100 : '', index === 0 ? (premiumKobo + fees.nhisFeeKobo) / 100 : '',
        index === 0 ? Math.max(0, premiumKobo + fees.nhisFeeKobo - verified) / 100 : '',
      ];
      sheet.addRow(adminFull ? row : row.filter((_value, columnIndex) => columnIndex !== 24));
    }
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12372A' } };
  header.height = 34;
  sheet.columns.forEach((column, index) => { column.width = index >= 13 && index <= 22 ? 24 : 18; });
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(columns.length).letter}1` };
  for (let column = 25; column <= columns.length; column += 1) {
    sheet.getColumn(column).numFmt = '₦#,##0.00';
  }
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
  ];
  for (const enrollment of snapshot.enrollments) {
    const plan = snapshot.plans.find((item) => item.id === enrollment.planId);
    const related = snapshot.payments.filter((item) => item.enrollmentId === enrollment.id);
    const paid = related.filter((item) => item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
    const pending = related.filter((item) => item.status === 'pending').reduce((sum, item) => sum + item.amountKobo, 0);
    sheet.addRow({ name: fullName(enrollment.principal), plan: plan?.name ?? 'Not selected', category: enrollment.category, owed: enrollment.totalKobo / 100, paid: paid / 100, pending: pending / 100, outstanding: Math.max(0, enrollment.totalKobo - paid) / 100, status: enrollment.status });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12372A' } };
  ['D', 'E', 'F', 'G'].forEach((column) => { sheet.getColumn(column).numFmt = '₦#,##0.00'; });
  sheet.autoFilter = { from: 'A1', to: 'H1' };
  const buffer = await workbook.xlsx.writeBuffer();
  saveBuffer(buffer as ArrayBuffer, `FUTO-HMO-Summary-${snapshot.period.year}.xlsx`);
}
