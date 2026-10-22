import { describe, expect, it } from 'vitest';
import { adminFullExportColumns, avonExportColumns, createEnrollmentWorkbook, createSummaryWorkbook } from './export';
import { demoSnapshot } from '../data/demo';

describe('enrollment export columns', () => {
  it('exports individual zero-credit terms instead of shared assessment defaults', async () => {
    const ExcelJS = await import('exceljs');
    const enrollment = demoSnapshot.enrollments[0];
    const snapshot = { ...demoSnapshot, enrollments: [{ ...enrollment, dependents: [] }], assessmentAdjustments: [{ ...demoSnapshot.assessmentAdjustments[0], amountKobo: 1_500_000, feePortionKobo: 1_500_000, futureCreditKobo: 0, creditYear: demoSnapshot.period.year + 1 }] };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createEnrollmentWorkbook(snapshot, 'admin'));
    const sheet = workbook.worksheets[0];
    const value = (header: string) => sheet.getRow(2).getCell(adminFullExportColumns.indexOf(header) + 1).value;
    expect(value('FUTURE ENROLLMENT CREDIT')).toBe(0);
    expect(value('ASSESSMENT CONTRIBUTION')).toBe(15_000);
    expect(value('ASSESSMENT ONE-TIME FEE')).toBe(15_000);
    await workbook.xlsx.load(await createSummaryWorkbook(snapshot));
    const summary = workbook.worksheets[0];
    const headers = (summary.getRow(1).values as string[]).slice(1);
    expect(summary.getRow(2).getCell(headers.indexOf('Planned future credit') + 1).value).toBe(0);
    expect(summary.getRow(2).getCell(headers.indexOf('Assessment contribution') + 1).value).toBe(15_000);
  });

  it('keeps all internal accounting fields only in the admin full export', () => {
    expect(adminFullExportColumns).toContain('FUTO HMO FULL PAYMNT');
    expect(avonExportColumns).not.toContain('FUTO HMO FULL PAYMNT');
    for (const column of ['HMO PAYMENT POSITION', 'HMO UNDERPAYMENT', 'HMO OVERPAYMENT', 'PROGRAM ASSESSMENT', 'ASSESSMENT PAID', 'ASSESSMENT NET DUE', 'FUTURE ENROLLMENT CREDIT']) {
      expect(adminFullExportColumns).toContain(column);
      expect(avonExportColumns).not.toContain(column);
    }
  });

  it('reports a late enrollee proration and next-year carry-forward only in internal exports', async () => {
    const ExcelJS = await import('exceljs');
    const late = demoSnapshot.enrollments[1];
    const snapshot = { ...demoSnapshot, enrollments: [late], payments: [{ ...demoSnapshot.payments[0], enrollmentId: late.id, amountKobo: late.totalKobo, status: 'verified' as const }] };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createEnrollmentWorkbook(snapshot, 'admin'));
    const value = (header: string) => workbook.worksheets[0].getRow(2).getCell(adminFullExportColumns.indexOf(header) + 1).value;
    expect(value('LATE ENROLLMENT')).toBe('YES');
    expect(value('AVON BILLED MONTHS')).toBe(11);
    expect(value('PRORATION CREDIT')).toBe(late.proration!.creditKobo / 100);
    // Unassigned to the assessment, so the one-time registration fee is charged next year.
    expect(value('CARRY-FORWARD CAC BALANCE')).toBe(-15_000);
    expect(value('CARRY-FORWARD NET')).toBe((late.proration!.creditKobo - 1_500_000) / 100);
    for (const column of ['LATE ENROLLMENT', 'AVON COVERAGE START', 'AVON PRORATED PREMIUM', 'PRORATION CREDIT', 'BROUGHT FORWARD FROM PRIOR YEAR', 'CARRY-FORWARD NET']) {
      expect(avonExportColumns).not.toContain(column);
    }
    await workbook.xlsx.load(await createSummaryWorkbook(snapshot));
    const summary = workbook.worksheets[0];
    const headers = (summary.getRow(1).values as string[]).slice(1);
    expect(summary.getRow(2).getCell(headers.indexOf('AVON coverage') + 1).value).toMatch(/^Late: 11 months from 01\//);
    expect(summary.getRow(2).getCell(headers.indexOf('Proration credit') + 1).value).toBe(late.proration!.creditKobo / 100);
  });

  it('sends AVON enrollment fields only, keeping premium and balance columns internal', async () => {
    for (const column of ['AVON PREMIUM', 'AVON (+ NHIS FEE)', 'AVON BALANCE']) {
      expect(avonExportColumns).not.toContain(column);
      expect(adminFullExportColumns).toContain(column);
    }
    expect(avonExportColumns.slice(-3)).toEqual(['HOSPITAL NAME', 'PLAN TYPE', 'CLIENT NAME']);
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createEnrollmentWorkbook(demoSnapshot, 'avon'));
    const sheet = workbook.worksheets[0];
    // Every AVON row ends at CLIENT NAME, with no stray financial values beyond it.
    expect(sheet.columnCount).toBe(avonExportColumns.length);
    expect(sheet.getRow(2).getCell(avonExportColumns.length).value).toBe('FUTO Alumni HMO');
  });

  it('writes distinct headers into the generated Excel workbooks', async () => {
    const ExcelJS = await import('exceljs');
    const headers = async (kind: 'avon' | 'admin') => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await createEnrollmentWorkbook(demoSnapshot, kind));
      return (workbook.worksheets[0].getRow(1).values as unknown[]).slice(1);
    };

    expect(await headers('avon')).toEqual(avonExportColumns);
    expect(await headers('admin')).toEqual(adminFullExportColumns);
  });

  it('keeps draft records internal and out of the AVON submission', async () => {
    const ExcelJS = await import('exceljs');
    const draftSnapshot = { ...demoSnapshot, enrollments: demoSnapshot.enrollments.map((item) => ({ ...item, status: 'draft' as const })) };
    const rows = async (kind: 'avon' | 'admin') => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await createEnrollmentWorkbook(draftSnapshot, kind));
      return workbook.worksheets[0].rowCount;
    };
    expect(await rows('avon')).toBe(1);
    expect(await rows('admin')).toBeGreaterThan(1);
  });

  it('leaves a missing date blank rather than writing a malformed provider value', async () => {
    const ExcelJS = await import('exceljs');
    const enrollment = demoSnapshot.enrollments[0];
    const snapshot = {
      ...demoSnapshot,
      enrollments: [{ ...enrollment, status: 'submitted' as const, dependents: [], principal: { ...enrollment.principal, enrollmentDate: '' } }],
    };
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createEnrollmentWorkbook(snapshot, 'avon'));
    const sheet = workbook.worksheets[0];
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    const cell = sheet.getRow(2).getCell(headers.indexOf('ENROLLMENT_DATE(DD/MM/YYYY)') + 1).value;
    expect(cell ?? '').toBe('');
  });

  it('uses principal contact details only for blank dependent fields in the AVON export', async () => {
    const ExcelJS = await import('exceljs');
    const enrollment = demoSnapshot.enrollments[0];
    const dependent = { ...enrollment.dependents[0], middleName: '', mobile: '', email: '' };
    const snapshot = {
      ...demoSnapshot,
      enrollments: [{ ...enrollment, status: 'submitted' as const, dependents: [dependent] }],
    };
    const dependentValue = async (kind: 'avon' | 'admin', column: string) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await createEnrollmentWorkbook(snapshot, kind));
      const sheet = workbook.worksheets[0];
      const headers = (sheet.getRow(1).values as unknown[]).slice(1);
      return sheet.getRow(3).getCell(headers.indexOf(column) + 1).value;
    };

    expect(await dependentValue('avon', 'MOBILE_NO')).toBe(enrollment.principal.mobile);
    expect(await dependentValue('avon', 'EMAIL')).toBe(enrollment.principal.email);
    expect(await dependentValue('admin', 'MOBILE_NO')).toBe('');
    expect(await dependentValue('admin', 'EMAIL')).toBe('');
    expect(await dependentValue('avon', 'MIDDLE_NAME')).toBe('');
  });
});
