import ExcelJS from 'exceljs';
import { getInspectionsByDate } from '../db/inspections';
import { getIssues } from '../db/issues';
import type { OpenIssue, TenantScope, Shift } from '../types';

const STATUS_LABELS: Record<string, string> = {
  reviewed_ok:           'OK',
  reviewed_observation:  'Con observación',
  serious_issue:         'Problema grave',
  not_returned:          'No retornó',
  other:                 'Otro',
};

const SHIFT_LABELS: Record<string, string> = {
  morning:   'Mañana',
  afternoon: 'Tarde',
  night:     'Noche',
};

const FUEL_LABELS: Record<string, string> = {
  empty:          'Vacío',
  quarter:        '1/4',
  half:           '1/2',
  three_quarters: '3/4',
  full:           'Lleno',
};

export async function generateDailyExcel(date: string, scope: TenantScope, shift?: Shift): Promise<Buffer> {
  const workbook    = new ExcelJS.Workbook();
  workbook.creator  = 'Vehicle Inspection App';
  workbook.created  = new Date();

  const inspections = await getInspectionsByDate(date, scope, shift);
  const openIssues  = await getIssues({ status: 'open' }, scope) as OpenIssue[];

  const counts = inspections.reduce(
    (acc, i) => {
      if (i.status === 'reviewed_ok' || i.status === 'reviewed_observation') acc.reviewed++;
      if (i.status === 'serious_issue') acc.issues++;
      if (i.status === 'not_returned')  acc.notReturned++;
      if (i.status === 'other')         acc.other++;
      return acc;
    },
    { reviewed: 0, issues: 0, notReturned: 0, other: 0 },
  );
  const guardNames = [...new Set(inspections.map(i => i.guardName))].join(', ');

  // ─── Sheet 1: Resumen ────────────────────────────────────────────────────────
  const summarySheet = workbook.addWorksheet('Resumen');
  summarySheet.columns = [
    { header: 'Campo', key: 'campo', width: 30 },
    { header: 'Valor', key: 'valor', width: 30 },
  ];
  applyHeaderStyle(summarySheet);
  summarySheet.addRows([
    { campo: 'Fecha',             valor: date },
    { campo: 'Turno',             valor: shift ? (SHIFT_LABELS[shift] ?? shift) : 'Todos' },
    { campo: 'Guardias',          valor: guardNames },
    { campo: 'Total inspecciones', valor: inspections.length },
    { campo: 'Revisados',         valor: counts.reviewed },
    { campo: 'Con problemas',     valor: counts.issues },
    { campo: 'No retornaron',     valor: counts.notReturned },
    { campo: 'Otros',             valor: counts.other },
  ]);

  // ─── Sheet 2: Inspecciones ───────────────────────────────────────────────────
  const detailSheet = workbook.addWorksheet('Inspecciones');
  detailSheet.columns = [
    { header: 'Placa',           key: 'plate',       width: 12 },
    { header: 'Turno',           key: 'shift',       width: 12 },
    { header: 'Guardia',         key: 'guard',       width: 22 },
    { header: 'Estado',          key: 'status',      width: 20 },
    { header: 'Conductor final', key: 'driver',      width: 25 },
    { header: 'Kilometraje',     key: 'mileage',     width: 14 },
    { header: 'Km anterior',     key: 'prevMileage', width: 14 },
    { header: 'Diferencia Km',   key: 'diff',        width: 14 },
    { header: 'Combustible',     key: 'fuel',        width: 14 },
    { header: 'Limpieza',        key: 'cleanliness', width: 14 },
    { header: 'Herramientas',    key: 'tools',       width: 14 },
    { header: 'Exterior',        key: 'exterior',    width: 14 },
    { header: 'Interior',        key: 'interior',    width: 14 },
    { header: 'Observación',     key: 'obs',         width: 40 },
    { header: 'Tiene issue',     key: 'hasIssue',    width: 12 },
    { header: 'Tiene fotos',     key: 'hasPhotos',   width: 12 },
    { header: 'Hora',            key: 'at',          width: 22 },
  ];
  applyHeaderStyle(detailSheet);
  for (const insp of inspections) {
    detailSheet.addRow({
      plate:       insp.plate,
      shift:       SHIFT_LABELS[insp.shift] ?? insp.shift,
      guard:       insp.guardName,
      status:      STATUS_LABELS[insp.status] ?? insp.status,
      driver:      insp.finalDriverNameManual ?? insp.finalDriverId ?? '',
      mileage:     insp.mileage               ?? '',
      prevMileage: insp.previousMileage       ?? '',
      diff:        insp.mileageDifference     ?? '',
      fuel:        FUEL_LABELS[insp.fuelLevel ?? ''] ?? insp.fuelLevel ?? '',
      cleanliness: insp.cleanlinessStatus     ?? '',
      tools:       insp.toolsGeneralStatus    ?? '',
      exterior:    insp.exteriorGeneralStatus ?? '',
      interior:    insp.interiorGeneralStatus ?? '',
      obs:         insp.generalObservation    ?? '',
      hasIssue:    insp.hasNewIssue  ? 'Sí' : 'No',
      hasPhotos:   insp.hasPhotos    ? 'Sí' : 'No',
      at:          insp.createdAt,
    });
  }

  // ─── Sheet 3: Problemas abiertos ─────────────────────────────────────────────
  const issuesSheet = workbook.addWorksheet('Problemas abiertos');
  issuesSheet.columns = [
    { header: 'Placa',            key: 'plate',    width: 12 },
    { header: 'Tipo',             key: 'type',     width: 20 },
    { header: 'Descripción',      key: 'desc',     width: 40 },
    { header: 'Severidad',        key: 'severity', width: 12 },
    { header: 'Estado',           key: 'status',   width: 14 },
    { header: 'Detectado por',    key: 'by',       width: 20 },
    { header: 'Fecha detección',  key: 'at',       width: 20 },
  ];
  applyHeaderStyle(issuesSheet);
  for (const issue of openIssues) {
    issuesSheet.addRow({
      plate:    issue.plate,
      type:     issue.issueType,
      desc:     issue.description,
      severity: issue.severity,
      status:   issue.status,
      by:       issue.detectedBy,
      at:       issue.detectedAt,
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function applyHeaderStyle(sheet: ExcelJS.Worksheet): void {
  const headerRow          = sheet.getRow(1);
  headerRow.font           = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill           = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  headerRow.alignment      = { vertical: 'middle', horizontal: 'center' };
  headerRow.height         = 20;
}
