import { describe, expect, it } from 'vitest';
import { adminFullExportColumns, avonExportColumns, createEnrollmentWorkbook } from './export';
import { demoSnapshot } from '../data/demo';

describe('enrollment export columns', () => {
  it('keeps the internal payment field only in the admin full export', () => {
    expect(adminFullExportColumns).toContain('FUTO HMO FULL PAYMNT');
    expect(avonExportColumns).not.toContain('FUTO HMO FULL PAYMNT');
    expect(avonExportColumns).toEqual(
      adminFullExportColumns.filter((column) => column !== 'FUTO HMO FULL PAYMNT'),
    );
  });

  it('moves AVON financial columns into the correct provider template positions', () => {
    expect(avonExportColumns.slice(-3)).toEqual([
      'AVON PREMIUM',
      'AVON (+ NHIS FEE)',
      'AVON BALANCE',
    ]);
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
