// ─── Roles ───────────────────────────────────────────────────────────────────

export type UserRole = 'guardia' | 'jefe_operaciones' | 'admin' | 'admin_pais' | 'admin_global';

// ─── Users ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  branchId?: number | null;
  countryId?: number | null;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  passwordHash: string;
  lastLogin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthPayload {
  userId: string;
  username: string;
  role: UserRole;
  fullName: string;
  branchId?: number;
  countryId?: number;
}

// ─── Tenant Scope ─────────────────────────────────────────────────────────────

export type TenantScope =
  | { kind: 'branch';  branchId:  number }
  | { kind: 'country'; countryId: number }
  | { kind: 'global' };

// ─── Drivers ─────────────────────────────────────────────────────────────────

export interface Driver {
  id: string;
  branchId: number;
  name: string;
  department: string;
  active: boolean;
  createdAt: string;
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

export interface Vehicle {
  id: string;
  branchId: number;
  plate: string;
  vehicleType: string;
  brand: string;
  model: string;
  year?: number;
  chassisNumber?: string;
  vin?: string;
  engineNumber?: string;
  active: boolean;
  notes?: string;
  initialMileage: number;
  lastMileage: number;
  lastInspectionDate?: string;
  hasOpenIssues: boolean;
  // ── Estado persistente (modelo stream v2.0) ──────────────────────────────
  currentStatus: VehicleStatus;
  currentStatusReason?: string;
  currentStatusExpectedReturn?: string;
  currentStatusSince?: string;
  currentStatusBy?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Estado persistente del vehículo. 'active' es el estado base (hardcoded).
 * Los demás estados viven en la tabla VehicleStatusTypes y son configurables
 * por admin_pais+. El tipo es string para soportar tipos dinámicos.
 */
export type VehicleStatus = string;

/** Tipo de estado especial de vehículo (tabla VehicleStatusTypes). */
export interface VehicleStatusType {
  id:          number;
  key:         string;
  labelEs:     string;
  color:       string;
  countryId?:  number;
  isSystem:    boolean;
  active:      boolean;
  sortOrder:   number;
}

// ─── Shift (modelo stream v2.0 — ya no hay sesiones) ───────────────────────────

export type Shift = 'morning' | 'afternoon' | 'night';
/** @deprecated El modelo ya no tiene sesiones. Usar `Shift`. */
export type SessionShift = Shift;

// ─── Inspections (cada inspección es un evento autocontenido) ──────────────────

/** Eventos puntuales del turno. Los estados persistentes viven en VehicleStatus. */
/** Direction of the vehicle event. 'exit' will be used when exit registration is enabled. */
export type InspectionDirection = 'entry' | 'exit';

export type ReturnStatus =
  | 'received'
  | 'not_returned'
  | 'never_left'
  | 'other';

export type InspectionStatus =
  | 'reviewed_ok'
  | 'reviewed_observation'
  | 'serious_issue'
  | 'not_returned'
  | 'other';

/**
 * Ciclo de vida del evento (v2.2). 'draft' = borrador en captura (invisible a
 * reportes, kilometraje antifraude, conteo visto/no-visto y creación de issues);
 * 'final' = registrado. DEFAULT 'final' en BD preserva todo el comportamiento previo.
 */
export type LifecycleStatus = 'draft' | 'final';

export type FuelLevel = 'empty' | 'quarter' | 'half' | 'three_quarters' | 'full';
export type CleanlinessStatus = 'clean' | 'acceptable' | 'dirty' | 'very_dirty';
export type GeneralStatus = 'ok' | 'observed' | 'damaged';
export type ToolsStatus = 'ok' | 'missing' | 'damaged' | 'not_applicable';
export type MileageWarningType = 'none' | 'lower_than_previous' | 'unusually_high';

export interface Inspection {
  id: string;
  branchId: number;
  vehicleId: string;
  plate: string;
  localDate: string;         // fecha OPERATIVA del turno (YYYY-MM-DD) — no la de reloj
  shift: Shift;              // turno calculado por la hora local al registrar
  direction: InspectionDirection;  // 'entry' hoy; 'exit' cuando se implemente salida
  guardId: string;           // autor del evento (autoría por evento)
  guardName: string;
  finalDriverId?: string;
  finalDriverNameManual?: string;
  returnStatus: ReturnStatus;
  status: InspectionStatus;
  lifecycleStatus: LifecycleStatus;  // 'draft' | 'final' (v2.2)
  authorizedBy?: string;
  expectedReturnDate?: string;
  mileage?: number;
  previousMileage?: number;
  mileageDifference?: number;
  mileageWarningType: MileageWarningType;
  mileageWarningConfirmed: boolean;
  mileageWarningObservation?: string;
  fuelLevel?: FuelLevel;
  cleanlinessStatus?: CleanlinessStatus;
  toolsGeneralStatus?: ToolsStatus;
  exteriorGeneralStatus?: GeneralStatus;
  interiorGeneralStatus?: GeneralStatus;
  generalObservation?: string;
  hasNewIssue: boolean;
  hasPhotos: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // Sellado al cambiar el turno: editar una inspección de un turno pasado
  // requiere supervisor + justificación (queda en AuditLogs).
  modifiedAfterSeal: boolean;
  modifiedBy?: string;
  modifiedReason?: string;
}

// ─── Open Issues ──────────────────────────────────────────────────────────────

export type IssueType = 'damage' | 'missing_tool' | 'cleanliness_problem' | 'documentation_problem' | 'other';
export type IssueSeverity = 'low' | 'medium' | 'high';
export type IssueStatus = 'open' | 'in_process' | 'resolved' | 'dismissed';

export interface OpenIssue {
  id: string;
  vehicleId: string;
  branchId?: number;
  plate: string;
  inspectionId: string;
  issueType: IssueType;
  category?: string;
  description: string;
  severity: IssueSeverity;
  status: IssueStatus;
  detectedBy: string;
  detectedAt: string;
  maintenanceAction?: string;
  closedBy?: string;
  closedAt?: string;
  closingObservation?: string;
}

// ─── Photos ───────────────────────────────────────────────────────────────────

export type PhotoType =
  | 'odometer'
  | 'exterior_damage'
  | 'interior_damage'
  | 'missing_tool'
  | 'cleanliness'
  | 'other'
  | 'non_return_evidence';

export interface Photo {
  id: string;
  inspectionId?: string;
  openIssueId?: string;
  vehicleId: string;
  plate: string;
  type: PhotoType;
  fileName: string;
  storagePath: string;
  internalUrl: string;
  uploadedBy: string;
  uploadedAt: string;
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  timestamp: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
// The settings catalog lives in utils/settingsRegistry.ts (single source of
// truth). Typed access at runtime is via TypedSettings / getTypedSettings.

// ─── API Response ─────────────────────────────────────────────────────────────

export type UIState =
  | 'saved_successfully'
  | 'photo_uploading'
  | 'photo_uploaded'
  | 'validation_error'
  | 'mileage_warning'
  | 'session_ready_to_submit'
  | 'report_submitted'
  | 'open_issue_created'
  | 'unauthorized'
  | 'not_found'
  | 'server_error';

export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: string;
  message: string;
  uiState: UIState;
  data?: T;
  errors?: Record<string, string[]>;
}

// ─── Dashboard (modelo stream v2.0) ────────────────────────────────────────────

/**
 * Qué ocurrió hoy con este vehículo (cualquier turno del día).
 * Extiende ReturnStatus con 'none' (sin registro aún).
 * Usar este discriminador evita múltiples booleanos y escala
 * automáticamente si se agregan nuevos ReturnStatus en el futuro.
 */
export type TodayRecordKind = 'none' | ReturnStatus;
// 'none'         → sin registro hoy
// 'received'     → llegó e inspeccionado
// 'never_left'   → sin actividad hoy (no salió)
// 'not_returned' → salió pero no regresó
// 'other'        → otro motivo registrado

export interface VehicleDashboardCard {
  vehicleId: string;
  plate: string;
  vehicleType: string;
  brand: string;
  model: string;
  currentStatus: VehicleStatus;
  currentStatusExpectedReturn?: string;
  hasOpenIssues: boolean;
  /** Actividad de hoy: kind discrimina el estado; inspectionId permite editar. */
  todayRecord: {
    kind: TodayRecordKind;
    inspectionId?: string;
    inspectionStatus?: InspectionStatus; // solo cuando kind === 'received'
  };
  /** Borrador de inspección pendiente en este bucket (turno actual), si existe. */
  draft?: {
    inspectionId: string;
    updatedAt: string;
  };
  lastInspectionDate?: string;
  daysSinceLastReview?: number;
  noReviewAlert: boolean;
  /** Último kilometraje registrado — baseline para la alerta local en el formulario. */
  lastMileage: number;
}

/**
 * Dashboard del guardia: el turno actual calculado server-side + la flota con
 * su estado de "visto / no visto" en ese turno. No hay sesión ni gate de envío.
 */
export interface GuardDashboard {
  branchId:  number;
  localDate: string;
  shift:     Shift;
  timezone:  string;
  guardName: string;
  vehicles:  VehicleDashboardCard[];
  counts: {
    total:  number;   // vehículos activos
    seen:   number;   // inspeccionados este turno
    unseen: number;   // activos sin inspección este turno (monitor suave)
  };
}

/** Reporte de turno (supervisión / export) — agregación del stream. */
export interface ShiftReport {
  branchId:    number;
  localDate:   string;
  shift:       Shift;
  guardNames:  string[];
  inspections: Inspection[];
  counts: {
    total:        number;
    reviewed:     number;
    issues:       number;
    notReturned:  number;
    other:        number;
  };
}

// ─── Mileage Validation ───────────────────────────────────────────────────────

export interface MileageValidationResult {
  hasWarning: boolean;
  warningType: MileageWarningType;
  warningMessage?: string;
  previousMileage: number;
  difference: number;
}

// ─── Express Request Extension ────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}
