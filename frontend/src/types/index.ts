export type UserRole = 'guardia' | 'jefe_operaciones' | 'admin' | 'admin_pais' | 'admin_global';

export interface AuthUser {
  userId:    string;
  username:  string;
  role:      UserRole;
  fullName:  string;
  branchId?: number;
  countryId?: number;
}

export type Shift = 'morning' | 'afternoon' | 'night';

export type InspectionStatus =
  | 'reviewed_ok'
  | 'reviewed_observation'
  | 'serious_issue'
  | 'not_returned'
  | 'other';

export type ReturnStatus =
  | 'received'
  | 'not_returned'
  | 'never_left'
  | 'other';

/** Ciclo de vida del evento (v2.2): borrador en captura o registrado. */
export type LifecycleStatus = 'draft' | 'final';

/**
 * Estado persistente del vehículo. 'active' es el estado base (hardcoded).
 * Los demás estados viven en VehicleStatusTypes y son configurables por admin_pais+.
 */
export type VehicleStatus = string;

/** Tipo de estado especial de vehículo (tabla VehicleStatusTypes). */
export interface VehicleStatusType {
  id:         number;
  key:        string;
  labelEs:    string;
  color:      string;
  countryId?: number;
  isSystem:   boolean;
  active:     boolean;
  sortOrder:  number;
}

/**
 * Qué ocurrió hoy con este vehículo (cualquier turno del día).
 * Extiende ReturnStatus con 'none' (sin registro aún).
 */
export type TodayRecordKind = 'none' | ReturnStatus;

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
  /** Borrador de inspección pendiente en el turno actual, si existe. */
  draft?: {
    inspectionId: string;
    updatedAt: string;
  };
  lastInspectionDate?: string;
  daysSinceLastReview?: number;
  noReviewAlert: boolean;
  /** Último km registrado — baseline para la alerta de odómetro en el formulario. */
  lastMileage: number;
}

/** Dashboard del guardia: turno actual + flota con estado visto/no-visto. */
export interface GuardDashboard {
  branchId: number;
  localDate: string;
  shift: Shift;
  timezone: string;
  guardName: string;
  vehicles: VehicleDashboardCard[];
  counts: { total: number; seen: number; unseen: number };
}

export interface Driver {
  id: string;
  name: string;
  department: string;
}

export type FuelLevel = 'empty' | 'quarter' | 'half' | 'three_quarters' | 'full';
export type CleanlinessStatus = 'clean' | 'acceptable' | 'dirty' | 'very_dirty';
export type GeneralStatus = 'ok' | 'observed' | 'damaged';
export type ToolsStatus = 'ok' | 'missing' | 'damaged' | 'not_applicable';

export interface InspectionFormData {
  /** Presente solo al editar una inspección existente (supervisor / turno actual). */
  inspectionId?: string;
  /** 'draft' = guardar borrador (sin validación/efectos); 'final' (default) = finalizar. */
  intent?: LifecycleStatus;
  vehicleId: string;
  plate: string;
  returnStatus: ReturnStatus;
  authorizedBy?: string;
  expectedReturnDate?: string;
  finalDriverId?: string;
  finalDriverNameManual?: string;
  mileage?: number;
  fuelLevel?: FuelLevel;
  cleanlinessStatus?: CleanlinessStatus;
  toolsGeneralStatus?: ToolsStatus;
  exteriorGeneralStatus?: GeneralStatus;
  interiorGeneralStatus?: GeneralStatus;
  generalObservation?: string;
  mileageWarningConfirmed?: boolean;
  mileageWarningObservation?: string;
  modificationReason?: string;
}

export interface MileageWarning {
  warningType: 'lower_than_previous' | 'unusually_high';
  previousMileage: number;
  newMileage: number;
  difference: number;
  message: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  statusCode: string;
  message: string;
  uiState: string;
  data?: T;
  errors?: Record<string, string[]>;
}

export interface OpenIssue {
  id: string;
  plate: string;
  vehicleId: string;
  issueType: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'in_process' | 'resolved' | 'dismissed';
  detectedBy: string;
  detectedAt: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export type SettingLevel  = 'branch' | 'country' | 'global';
export type SettingSource = 'default' | 'global' | 'country' | 'branch';
export type SettingKey    =
  | 'unusually_high_mileage_threshold'
  | 'no_review_days_threshold'
  | 'unseen_alert_hours'
  | 'shift_morning_start'
  | 'shift_afternoon_start'
  | 'shift_night_start'
  | 'week_start_day'
  | 'audit_log_retention_days'
  | 'max_photo_size_mb';

export interface SettingMeta {
  value:         number | boolean;
  source:        SettingSource;
  writableFrom:  SettingLevel;
  overridableTo: SettingLevel;
  canEdit:       boolean;
  description:   string;
}

export type SettingsData = Record<SettingKey, SettingMeta>;

export type TargetScope =
  | { level: 'global' }
  | { level: 'country'; countryId: number }
  | { level: 'branch';  branchId:  number };
