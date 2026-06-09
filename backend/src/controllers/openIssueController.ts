import { Request, Response, NextFunction } from 'express';
import { getIssues, getIssueById, updateIssue, getOpenIssuesByVehicle } from '../db/issues';
import { setOpenIssuesFlag } from '../db/vehicles';
import { createAuditLog } from '../db/audit';
import { resolveScope } from '../middleware/tenantScope';

export async function listOpenIssues(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, vehicleId, plate } = req.query;
    const issues = await getIssues(
      {
        status:    status    as string | undefined,
        vehicleId: vehicleId as string | undefined,
        plate:     plate     as string | undefined,
      },
      resolveScope(req.user!),
    );
    res.json({ success: true, statusCode: 'OK', message: `${issues.length} problema(s) encontrado(s).`, uiState: 'saved_successfully', data: issues });
  } catch (err) {
    next(err);
  }
}

export async function getOpenIssue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const issue = await getIssueById(req.params.id, resolveScope(req.user!));
    if (!issue) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Problema no encontrado.', uiState: 'not_found' });
      return;
    }
    res.json({ success: true, statusCode: 'OK', message: 'Problema encontrado.', uiState: 'saved_successfully', data: issue });
  } catch (err) {
    next(err);
  }
}

export async function updateIssueStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { status, maintenanceAction } = req.body;

    if (!['open', 'in_process', 'resolved', 'dismissed'].includes(status)) {
      res.status(400).json({ success: false, statusCode: 'INVALID_STATUS', message: 'Estado inválido.', uiState: 'validation_error' });
      return;
    }

    const issue = await getIssueById(id, resolveScope(req.user!));
    if (!issue) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Problema no encontrado.', uiState: 'not_found' });
      return;
    }

    await updateIssue(id, { status, maintenanceAction: maintenanceAction ?? '' });
    res.json({ success: true, statusCode: 'ISSUE_UPDATED', message: 'Estado del problema actualizado.', uiState: 'saved_successfully' });
  } catch (err) {
    next(err);
  }
}

export async function closeIssue(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { maintenanceAction, closingObservation, status = 'resolved' } = req.body;

    if (!maintenanceAction?.trim()) {
      res.status(400).json({ success: false, statusCode: 'ACTION_REQUIRED', message: 'Debe ingresar la acción tomada para cerrar el problema.', uiState: 'validation_error' });
      return;
    }

    const issue = await getIssueById(id, resolveScope(req.user!));
    if (!issue) {
      res.status(404).json({ success: false, statusCode: 'NOT_FOUND', message: 'Problema no encontrado.', uiState: 'not_found' });
      return;
    }

    const now = new Date().toISOString();
    await updateIssue(id, {
      status,
      maintenanceAction,
      closedBy:           req.user!.userId,
      closedAt:           now,
      closingObservation: closingObservation ?? '',
    });

    await createAuditLog({
      userId:   req.user!.userId,
      userName: req.user!.fullName,
      action:   'CLOSE_ISSUE',
      entity:   'OpenIssue',
      entityId: id,
      oldValue: { status: issue.status },
      newValue: { status, maintenanceAction, closingObservation },
      branchId: issue.branchId,
    });

    // getOpenIssuesByVehicle uses no scope intentionally — we need the total count
    // of ALL open issues for this vehicle to accurately update the flag.
    const remaining = await getOpenIssuesByVehicle(issue.vehicleId);
    await setOpenIssuesFlag(issue.vehicleId, remaining.length > 0);

    res.json({ success: true, statusCode: 'ISSUE_CLOSED', message: 'Problema cerrado correctamente.', uiState: 'saved_successfully' });
  } catch (err) {
    next(err);
  }
}
