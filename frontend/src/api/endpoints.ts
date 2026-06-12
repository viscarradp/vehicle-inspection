import { api } from './client';
import type { InspectionFormData, SettingLevel } from '../types';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  guards:  () => api.get('/auth/guards'),
  login:   (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  logout:  () => api.post('/auth/logout'),
  me:      () => api.get('/auth/me'),
};

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export const vehicleApi = {
  list:       () => api.get('/vehicles'),
  get:        (id: string) => api.get(`/vehicles/${id}`),
  history:    (id: string) => api.get(`/vehicles/${id}/history`),
  openIssues: (id: string) => api.get(`/vehicles/${id}/open-issues`),
  unseen:     () => api.get('/vehicles/unseen'),
  setStatus:  (id: string, body: { status: string; reason?: string; expectedReturnDate?: string }) =>
    api.patch(`/vehicles/${id}/status`, body),
};

// ─── Drivers ─────────────────────────────────────────────────────────────────

export const driverApi = {
  list: () => api.get('/drivers'),
};

// ─── Inspections ──────────────────────────────────────────────────────────────

export const inspectionApi = {
  dashboard: (branchId?: number) =>
    api.get('/inspections/dashboard', { params: branchId ? { branchId } : undefined }),
  // Sin inspectionId → registra/actualiza el evento del turno actual (guardia).
  // Con inspectionId → edita esa inspección por id (supervisor; PATCH).
  save: (data: InspectionFormData) =>
    data.inspectionId
      ? api.patch(`/inspections/${data.inspectionId}`, data)
      : api.post('/inspections', data),
  // Guarda un borrador (upsert por bucket del turno actual). Sin validación
  // bloqueante ni efectos colaterales — el registro queda en lifecycleStatus='draft'.
  saveDraft: (data: InspectionFormData) =>
    api.post('/inspections', { ...data, intent: 'draft' }),
  // Descarta un borrador. Solo aplica a registros en estado 'draft'.
  discard: (id: string) => api.delete(`/inspections/${id}`),
  get:  (id: string) => api.get(`/inspections/${id}`),
};

// ─── Photos ───────────────────────────────────────────────────────────────────

export const photoApi = {
  upload: (
    inspectionId: string,
    file: File,
    photoType: string,
    plate: string,
    vehicleId: string,
  ) => {
    const form = new FormData();
    form.append('photo', file);
    form.append('photoType', photoType);
    form.append('plate', plate);
    form.append('vehicleId', vehicleId);
    return api.post(`/inspections/${inspectionId}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  list: (inspectionId: string) => api.get(`/inspections/${inspectionId}/photos`),
};

// ─── Open Issues ──────────────────────────────────────────────────────────────

export const issueApi = {
  list: (params?: { status?: string; vehicleId?: string }) =>
    api.get('/open-issues', { params }),
  get:          (id: string) => api.get(`/open-issues/${id}`),
  updateStatus: (id: string, status: string, maintenanceAction?: string) =>
    api.put(`/open-issues/${id}/status`, { status, maintenanceAction }),
  close: (id: string, maintenanceAction: string, closingObservation?: string) =>
    api.post(`/open-issues/${id}/close`, { maintenanceAction, closingObservation }),
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export const reportApi = {
  daily:       (date: string, shift?: string) => api.get('/reports/daily', { params: { date, shift } }),
  exportDaily: (date: string, shift?: string) =>
    api.get('/reports/export/daily', { params: { date, shift }, responseType: 'blob' }),
  noReview:    (days = 3)     => api.get('/reports/no-review', { params: { days } }),
  vehicle:     (vehicleId: string) => api.get(`/reports/vehicle/${vehicleId}`),
  openIssues:  () => api.get('/reports/open-issues'),
};

// ─── Branches / países ────────────────────────────────────────────────────────

export const branchApi = {
  list:      (params?: { countryId?: number }) => api.get('/branches', { params }),
  countries: () => api.get('/countries'),
};

// ─── Vehicle Status Types ─────────────────────────────────────────────────────

export const vehicleStatusTypeApi = {
  list:    ()                        => api.get('/vehicle-status-types'),
  listAll: ()                        => api.get('/vehicle-status-types/all'),
  create:  (d: unknown)              => api.post('/vehicle-status-types', d),
  update:  (id: number, d: unknown)  => api.put(`/vehicle-status-types/${id}`, d),
  toggle:  (id: number)              => api.patch(`/vehicle-status-types/${id}/toggle`),
  delete:  (id: number)              => api.delete(`/vehicle-status-types/${id}`),
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ScopeParams {
  level?: SettingLevel;
  countryId?: number;
  branchId?: number;
}

export const settingsApi = {
  get:    (params?: ScopeParams) =>
    api.get('/settings', { params }),
  update: (body: Record<string, unknown>, params?: ScopeParams) =>
    api.put('/settings', body, { params }),
  reset:  (body: { keys?: string[] }, params?: ScopeParams) =>
    api.post('/settings/reset', body, { params }),
};

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminApi = {
  users: {
    list:   ()                        => api.get('/admin/users'),
    get:    (id: string)              => api.get(`/admin/users/${id}`),
    create: (d: unknown)              => api.post('/admin/users', d),
    update: (id: string, d: unknown)  => api.put(`/admin/users/${id}`, d),
  },
  vehicles: {
    list:       ()                        => api.get('/vehicles?all=1'),
    create:     (d: unknown)              => api.post('/admin/vehicles', d),
    update:     (id: string, d: unknown)  => api.put(`/admin/vehicles/${id}`, d),
    activate:   (id: string)              => api.patch(`/admin/vehicles/${id}/activate`),
    deactivate: (id: string)              => api.patch(`/admin/vehicles/${id}/deactivate`),
  },
  drivers: {
    list:       ()                        => api.get('/drivers?all=1'),
    create:     (d: unknown)              => api.post('/admin/drivers', d),
    update:     (id: string, d: unknown)  => api.put(`/admin/drivers/${id}`, d),
    activate:   (id: string)              => api.patch(`/admin/drivers/${id}/activate`),
    deactivate: (id: string)              => api.patch(`/admin/drivers/${id}/deactivate`),
  },
};
