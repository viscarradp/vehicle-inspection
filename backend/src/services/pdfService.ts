/**
 * pdfService.ts — Genera el PDF de reportes de inspección con PDFKit.
 *
 * Por qué PDFKit y no HTML→PDF (Puppeteer): el backend corre en node:20-alpine y
 * se empaqueta con esbuild; Chromium pesaría ~300 MB + dependencias de sistema.
 * PDFKit es JS puro y embebe imágenes desde Buffer.
 *
 * Imágenes: NO se resuelven URLs. Cada foto se lee como bytes vía la abstracción
 * de almacenamiento (`PhotoStorage.read`), se redimensiona con sharp y se embebe
 * directamente — así no hay dependencia de red, auth ni CORS dentro del documento.
 *
 * Layout por inspección (una por página):
 *   1. Información general y recepción   2. Control de condiciones (checklists)
 *   3. Estado visual y combustible       4. Observaciones
 *   5. Evidencia fotográfica (grid)
 */
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { getPhotosByInspection } from '../db/photos';
import { getPhotoStorage } from './storage';
import type { Inspection, Vehicle } from '../types';

// ─── Etiquetas legibles ─────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  reviewed_ok: 'Revisado OK', reviewed_observation: 'Con observación',
  serious_issue: 'Problema grave', not_returned: 'No retornó', other: 'Otro',
};
const SHIFT_LABEL: Record<string, string> = { morning: 'Mañana', afternoon: 'Tarde', night: 'Noche' };
const FUEL_LABEL:  Record<string, string> = { empty: 'Vacío', quarter: '1/4', half: '1/2', three_quarters: '3/4', full: 'Lleno' };
const FUEL_PCT:    Record<string, number> = { empty: 0, quarter: 25, half: 50, three_quarters: 75, full: 100 };
const CLEAN_LABEL: Record<string, string> = { clean: 'Limpio', acceptable: 'Aceptable', dirty: 'Sucio', very_dirty: 'Muy sucio' };
const RETURN_LABEL: Record<string, string> = { received: 'Recibido', not_returned: 'No retornó', never_left: 'No salió', other: 'Otro' };
const PHOTO_TYPE_LABEL: Record<string, string> = {
  odometer: 'Odómetro', exterior_damage: 'Daño exterior', interior_damage: 'Daño interior',
  missing_tool: 'Herramienta faltante', cleanliness: 'Limpieza', other: 'Otra',
  non_return_evidence: 'Evidencia de no retorno',
};

// ─── Geometría / paleta ──────────────────────────────────────────────────────────
const MARGIN = 40;
const PAGE_W = 595.28;          // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const NAVY = '#0b1f38';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

type Doc = PDFKit.PDFDocument;

// Chip de estado (Bueno/Malo) con color según severidad.
function chipColors(kind: 'good' | 'warn' | 'bad' | 'muted'): [string, string] {
  switch (kind) {
    case 'good': return ['#d1fae5', '#065f46'];
    case 'warn': return ['#fef3c7', '#92400e'];
    case 'bad':  return ['#fee2e2', '#991b1b'];
    default:     return ['#f1f5f9', '#475569'];
  }
}
function drawChip(doc: Doc, x: number, y: number, label: string, kind: 'good' | 'warn' | 'bad' | 'muted'): void {
  const [bg, fg] = chipColors(kind);
  doc.font('Helvetica-Bold').fontSize(9);
  const w = Math.max(46, doc.widthOfString(label) + 16);
  doc.roundedRect(x, y, w, 16, 4).fill(bg);
  doc.fillColor(fg).text(label, x, y + 4, { width: w, align: 'center' });
  doc.fillColor('#000000').font('Helvetica');
}
function areaKind(v?: string): 'good' | 'warn' | 'bad' | 'muted' {
  if (v === 'ok') return 'good';
  if (v === 'observed') return 'warn';
  if (v === 'damaged') return 'bad';
  return 'muted';
}
function areaLabel(v?: string): string {
  if (v === 'ok') return 'Bueno';
  if (v === 'observed') return 'Observado';
  if (v === 'damaged') return 'Daño';
  return '—';
}
function toolsKind(v?: string): 'good' | 'warn' | 'bad' | 'muted' {
  if (v === 'ok') return 'good';
  if (v === 'damaged') return 'warn';
  if (v === 'missing') return 'bad';
  return 'muted';
}
function toolsLabel(v?: string): string {
  if (v === 'ok') return 'Completas';
  if (v === 'damaged') return 'Daño';
  if (v === 'missing') return 'Faltante';
  return '—';
}

function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-GT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Banda de título de sección (navy, ancho completo). Avanza doc.y.
function sectionBand(doc: Doc, title: string): void {
  if (doc.y + 40 > PAGE_H - MARGIN) doc.addPage();
  const y = doc.y;
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10).text(title.toUpperCase(), MARGIN + 8, y + 5);
  doc.fillColor('#000000').font('Helvetica');
  doc.y = y + 24;
}

// Columna de pares etiqueta/valor. Devuelve la y inferior alcanzada.
function kvColumn(doc: Doc, x: number, w: number, top: number, heading: string, rows: Array<[string, string]>): number {
  let y = top;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(heading.toUpperCase(), x, y, { width: w });
  y += 13;
  for (const [label, value] of rows) {
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(label, x, y, { width: w });
    y += 9;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a').text(value || '—', x, y, { width: w });
    y += doc.heightOfString(value || '—', { width: w }) + 5;
  }
  doc.fillColor('#000000').font('Helvetica');
  return y;
}

function renderInspection(doc: Doc, insp: Inspection, vehicle?: Vehicle): void {
  // ── Encabezado: placa + estado + meta ──
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#0f172a').text(insp.plate, MARGIN, doc.y);
  const headerTop = doc.y - 26;
  doc.font('Helvetica').fontSize(9).fillColor(MUTED)
    .text(STATUS_LABEL[insp.status] ?? insp.status, MARGIN + 200, headerTop + 4, { width: CONTENT_W - 200, align: 'right' });
  doc.fontSize(9).fillColor(MUTED).text(
    `${SHIFT_LABEL[insp.shift] ?? insp.shift} · ${insp.localDate}  ·  Guardia: ${insp.guardName}`,
    MARGIN, doc.y + 2, { width: CONTENT_W },
  );
  doc.moveDown(0.6);
  doc.fillColor('#000000');

  // ── 1. Información general y recepción (3 columnas) ──
  sectionBand(doc, 'Información general y recepción');
  const colW = (CONTENT_W - 24) / 3;
  const x0 = MARGIN, x1 = MARGIN + colW + 12, x2 = MARGIN + 2 * (colW + 12);
  const top = doc.y;
  const driver = insp.finalDriverNameManual || (insp.finalDriverId ? `#${insp.finalDriverId}` : '');
  const diff = insp.mileageDifference;
  const b1 = kvColumn(doc, x0, colW, top, 'Vehículo', [
    ['Placa', insp.plate],
    ['Tipo / Marca / Modelo', vehicle ? `${vehicle.vehicleType || ''} ${vehicle.brand || ''} ${vehicle.model || ''}`.trim() : '—'],
    ['Año', vehicle?.year ? String(vehicle.year) : '—'],
  ]);
  const b2 = kvColumn(doc, x1, colW, top, 'Métricas', [
    ['Kilometraje', insp.mileage != null ? `${insp.mileage.toLocaleString('es-GT')} km` : '—'],
    ['Diferencia', diff != null ? `${diff >= 0 ? '+' : ''}${diff.toLocaleString('es-GT')} km` : '—'],
    ['Registrado', fmtDateTime(insp.createdAt)],
  ]);
  const b3 = kvColumn(doc, x2, colW, top, 'Responsables', [
    ['Entrega (conductor)', driver],
    ['Recibe (guardia)', insp.guardName],
    ['Retorno', RETURN_LABEL[insp.returnStatus] ?? insp.returnStatus],
  ]);
  doc.y = Math.max(b1, b2, b3) + 4;

  // ── 2. Control de condiciones (Exteriores / Interiores / Accesorios) ──
  sectionBand(doc, 'Control de condiciones');
  const y2 = doc.y;
  const labels = ['Exteriores', 'Interiores', 'Accesorios'];
  const chips: Array<[string, 'good' | 'warn' | 'bad' | 'muted']> = [
    [areaLabel(insp.exteriorGeneralStatus), areaKind(insp.exteriorGeneralStatus)],
    [areaLabel(insp.interiorGeneralStatus), areaKind(insp.interiorGeneralStatus)],
    [toolsLabel(insp.toolsGeneralStatus),   toolsKind(insp.toolsGeneralStatus)],
  ];
  [x0, x1, x2].forEach((x, i) => {
    doc.roundedRect(x, y2, colW, 50, 6).lineWidth(0.7).stroke(BORDER);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(labels[i], x, y2 + 8, { width: colW, align: 'center' });
    drawChip(doc, x + colW / 2 - 30, y2 + 26, chips[i][0], chips[i][1]);
  });
  doc.fillColor('#000000');
  doc.y = y2 + 58;

  // ── 3. Estado visual y combustible (2 columnas) ──
  sectionBand(doc, 'Estado visual y combustible');
  const y3 = doc.y;
  const halfW = (CONTENT_W - 12) / 2;
  // izquierda: limpieza / estado visual
  doc.roundedRect(x0, y3, halfW, 50, 6).lineWidth(0.7).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('ESTADO VISUAL', x0 + 10, y3 + 8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
    .text(`Limpieza: ${insp.cleanlinessStatus ? (CLEAN_LABEL[insp.cleanlinessStatus] ?? insp.cleanlinessStatus) : '—'}`, x0 + 10, y3 + 22);
  // derecha: combustible (barra)
  const fx = MARGIN + halfW + 12;
  doc.roundedRect(fx, y3, halfW, 50, 6).lineWidth(0.7).stroke(BORDER);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('COMBUSTIBLE', fx + 10, y3 + 8);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
    .text(insp.fuelLevel ? (FUEL_LABEL[insp.fuelLevel] ?? insp.fuelLevel) : '—', fx + 10, y3 + 22);
  const barX = fx + 10, barY = y3 + 38, barW = halfW - 20;
  doc.roundedRect(barX, barY, barW, 7, 3).fill('#e2e8f0');
  const pct = insp.fuelLevel ? FUEL_PCT[insp.fuelLevel] ?? 0 : 0;
  if (pct > 0) doc.roundedRect(barX, barY, (barW * pct) / 100, 7, 3).fill(NAVY);
  doc.fillColor('#000000');
  doc.y = y3 + 58;

  // ── 4. Observaciones ──
  sectionBand(doc, 'Observaciones');
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Notas generales', MARGIN, doc.y);
  doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a')
    .text(insp.generalObservation?.trim() || 'Sin observaciones.', MARGIN, doc.y + 1, { width: CONTENT_W });
  doc.fillColor('#000000');
  doc.moveDown(0.6);
}

// Lee + redimensiona las fotos de una inspección (async) antes de dibujar.
async function loadPhotoCells(inspectionId: string): Promise<Array<{ buf: Buffer; caption: string }>> {
  const photos  = await getPhotosByInspection(inspectionId);
  const storage = getPhotoStorage();
  const cells: Array<{ buf: Buffer; caption: string }> = [];
  for (const p of photos) {
    try {
      const raw = await storage.read(p.storagePath);
      const buf = await sharp(raw).rotate().resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
      const caption = `${PHOTO_TYPE_LABEL[p.type] ?? p.type} · ${new Date(p.uploadedAt).toLocaleDateString('es-GT')}`;
      cells.push({ buf, caption });
    } catch {
      // Foto faltante en el almacenamiento: se omite (no rompe el reporte).
    }
  }
  return cells;
}

// ── 5. Evidencia fotográfica (grid 3 columnas) ──
function renderPhotos(doc: Doc, cells: Array<{ buf: Buffer; caption: string }>): void {
  sectionBand(doc, 'Evidencia fotográfica');
  if (cells.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Sin fotos adjuntas a esta inspección.', MARGIN, doc.y);
    doc.fillColor('#000000');
    return;
  }
  const cols = 3, gap = 12;
  const cellW = (CONTENT_W - gap * (cols - 1)) / cols;
  const imgH = cellW * 0.72;
  const cellH = imgH + 16;
  let col = 0;
  let y = doc.y;
  for (const cell of cells) {
    if (col === 0 && y + cellH > PAGE_H - MARGIN) { doc.addPage(); y = doc.y; }
    const x = MARGIN + col * (cellW + gap);
    try {
      doc.image(cell.buf, x, y, { fit: [cellW, imgH], align: 'center', valign: 'center' });
    } catch { /* buffer no embebible: omitir imagen, dejar caption */ }
    doc.roundedRect(x, y, cellW, imgH, 4).lineWidth(0.7).stroke(BORDER);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(cell.caption, x, y + imgH + 2, { width: cellW, align: 'center' });
    col++;
    if (col === cols) { col = 0; y += cellH; }
  }
  doc.fillColor('#000000');
  doc.y = (col === 0 ? y : y + cellH);
}

/**
 * Genera el PDF con una inspección por página. `vehicleById` enriquece con
 * marca/modelo/tipo (opcional). `meta` define el título/subtítulo de portada.
 */
export async function generateInspectionsPdf(
  inspections: Inspection[],
  vehicleById: Map<string, Vehicle>,
  meta: { title: string; subtitle: string },
): Promise<Buffer> {
  // Prefetch de fotos (async) ANTES de dibujar: pdfkit dibuja de forma síncrona.
  const photoCells = new Map<string, Array<{ buf: Buffer; caption: string }>>();
  for (const insp of inspections) {
    photoCells.set(insp.id, await loadPhotoCells(insp.id));
  }

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // ── Portada / encabezado del reporte ──
  doc.rect(0, 0, PAGE_W, 70).fill(NAVY);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(meta.title, MARGIN, 18);
  doc.font('Helvetica').fontSize(10).fillColor('#cbd5e1').text(meta.subtitle, MARGIN, 44);
  doc.fillColor('#000000');
  doc.y = 86;

  if (inspections.length === 0) {
    doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('No hay inspecciones para los filtros seleccionados.', MARGIN, doc.y);
  }

  inspections.forEach((insp, idx) => {
    if (idx > 0) doc.addPage();
    else doc.moveDown(0.4);
    renderInspection(doc, insp, vehicleById.get(insp.vehicleId));
    renderPhotos(doc, photoCells.get(insp.id) ?? []);
  });

  doc.end();
  return done;
}
