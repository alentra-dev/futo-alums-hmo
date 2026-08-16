import type { ProgramSnapshot } from './types';
import { calculateFees } from './money';
import { fullName } from './format';

function saveBuffer(buffer: ArrayBuffer, name: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

const avonColumns = [
  'Timestamp', 'SNO', 'MEMBER_TYPE', 'SURNAME', 'FIRST_NAME', 'MIDDLE_NAME', 'DOB(DD/MM/YYYY)', 'GENDER', 'RELATION', 'NATIONALITY',
  'STAFF_NO (LEAVE THIS BLANK)', 'ENROLLEE_ID (LEAVE THIS BLANK)', 'ENROLLMENT_DATE(DD/MM/YYYY)', 'ADDRESS_OF_RESIDENCE',
  'COUNTRY_OF_RESIDENCE', 'STATE_OF_RESIDENCE', 'TOWN_OF_RESIDENCE', 'LGA_OF_RESIDENCE', 'MOBILE_NO', 'EMAIL',
  'CATEGORY(FAMILY/INDIVIDUAL)', 'HOSPITAL NAME', 'PLAN TYPE', 'CLIENT NAME', 'FUTO HMO FULL PAYMNT', 'AVON PREMIUM', 'AVON (+ NHIS FEE)', 'AVON BALANCE',
];

function dateForAvon(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export async function downloadAvonWorkbook(snapshot: ProgramSnapshot) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FUTO Alums HMO Program';
  const sheet = workbook.addWorksheet('AVON COMPLETED TEMPLATE', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(avonColumns);
  let serial = 1;
  for (const enrollment of snapshot.enrollments) {
    const plan = snapshot.plans.find((item) => item.id === enrollment.planId);
    if (!plan) continue;
    const premiumKobo = enrollment.category === 'family' ? plan.familyPremiumKobo : plan.individualPremiumKobo;
    const fees = calculateFees(premiumKobo);
    const verified = snapshot.payments.filter((item) => item.enrollmentId === enrollment.id && item.status === 'verified').reduce((sum, item) => sum + item.amountKobo, 0);
    for (const [index, person] of [enrollment.principal, ...enrollment.dependents].entries()) {
      sheet.addRow([
        new Date().toISOString(), serial++, person.memberType, person.surname.toUpperCase(), person.firstName.toUpperCase(), person.middleName.toUpperCase(),
        dateForAvon(person.dateOfBirth), person.gender, person.relation, person.nationality, '', '', dateForAvon(person.enrollmentDate), person.address,
        person.country, person.state, person.town, person.lga, person.mobile, person.email, enrollment.category.toUpperCase(), enrollment.hospital,
        `${plan.name.toUpperCase()} (${enrollment.category.toUpperCase()})`, 'FUTO Alumni HMO',
        index === 0 ? verified / 100 : '', index === 0 ? premiumKobo / 100 : '', index === 0 ? (premiumKobo + fees.nhisFeeKobo) / 100 : '',
        index === 0 ? Math.max(0, premiumKobo + fees.nhisFeeKobo - verified) / 100 : '',
      ]);
    }
  }
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF12372A' } };
  header.height = 34;
  sheet.columns.forEach((column, index) => { column.width = index >= 13 && index <= 22 ? 24 : 18; });
  sheet.autoFilter = { from: 'A1', to: 'AB1' };
  const moneyColumns = ['Y', 'Z', 'AA', 'AB'];
  moneyColumns.forEach((column) => { sheet.getColumn(column).numFmt = '₦#,##0.00'; });
  const buffer = await workbook.xlsx.writeBuffer();
  saveBuffer(buffer as ArrayBuffer, `FUTO-HMO-AVON-${snapshot.period.year}.xlsx`);
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
