/**
 * Seed script — unificado, multi-sucursal, no interactivo.
 *
 * Inicializa datos de prueba en las cuatro sedes (PA, GT, SV, NI) para
 * poder verificar el aislamiento de scope y las políticas RLS:
 *
 *   1. admin_global                      → acceso total
 *   2. admin_pais por cada país           → solo ve su país
 *   3. Guardia / jefe_operaciones por sucursal
 *   4. Conductores y vehículos por sucursal
 *      – PA (3 vehículos), GT (3), SV (3), NI (3)
 *      – Placas con formato regional para distinguirlos visualmente
 *
 * Ejecución: npm run db:seed  (o npx tsx src/scripts/seed.ts)
 * El script es idempotente: verifica antes de crear.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool, getConn, closePool, withScriptContext } from '../db/connection';
import { createUser, findUserByUsername, updateUser } from '../db/users';
import { createDriver, getActiveDrivers } from '../db/drivers';
import { createVehicle, getActiveVehicles } from '../db/vehicles';
import type { TenantScope, UserRole } from '../types';

// ─── Datos a sembrar ──────────────────────────────────────────────────────────

const GLOBAL_ADMIN = { username: 'admin', fullName: 'Administrador Global', role: 'admin_global' as UserRole };

const COUNTRY_ADMINS: { username: string; fullName: string; countryCode: string }[] = [
  { username: 'admin.pa', fullName: 'Admin Panamá',       countryCode: 'PA' },
  { username: 'admin.gt', fullName: 'Admin Guatemala',    countryCode: 'GT' },
  { username: 'admin.sv', fullName: 'Admin El Salvador',  countryCode: 'SV' },
  { username: 'admin.ni', fullName: 'Admin Nicaragua',    countryCode: 'NI' },
];

interface BranchSeed {
  countryCode: string;
  staff: { username: string; fullName: string; role: UserRole }[];
  drivers: { name: string; department: string }[];
  vehicles: { plate: string; vehicleType: string; brand: string; model: string; year: number }[];
}

const BRANCHES: BranchSeed[] = [
  {
    countryCode: 'PA',
    staff: [
      { username: 'carlos.r', fullName: 'Carlos Rodríguez', role: 'guardia' },
      { username: 'jorge.l',  fullName: 'Jorge López',      role: 'jefe_operaciones' },
    ],
    drivers: [
      { name: 'Juan Pérez',       department: 'Mantenimiento' },
      { name: 'María González',   department: 'Administración' },
      { name: 'Carlos Hernández', department: 'Operaciones' },
    ],
    vehicles: [
      { plate: 'P-123-ABC', vehicleType: 'Camioneta', brand: 'Toyota', model: 'Hilux',   year: 2022 },
      { plate: 'P-456-DEF', vehicleType: 'Sedán',     brand: 'Toyota', model: 'Corolla', year: 2021 },
      { plate: 'P-789-GHI', vehicleType: 'Camión',    brand: 'Isuzu',  model: 'NPR',     year: 2020 },
    ],
  },
  {
    countryCode: 'GT',
    staff: [
      { username: 'ana.g',   fullName: 'Ana García',    role: 'guardia' },
      { username: 'luis.m',  fullName: 'Luis Morales',  role: 'jefe_operaciones' },
    ],
    drivers: [
      { name: 'Roberto Méndez',  department: 'Logística' },
      { name: 'Elena Castillo',  department: 'Distribución' },
    ],
    vehicles: [
      { plate: 'GT-001-AXB', vehicleType: 'Camioneta', brand: 'Nissan',  model: 'Frontier', year: 2023 },
      { plate: 'GT-002-KLP', vehicleType: 'Pick-up',   brand: 'Ford',    model: 'Ranger',   year: 2022 },
      { plate: 'GT-003-MNZ', vehicleType: 'Microbús',  brand: 'Toyota',  model: 'Hiace',    year: 2021 },
    ],
  },
  {
    countryCode: 'SV',
    staff: [
      { username: 'maria.p',  fullName: 'María Pacheco',   role: 'guardia' },
      { username: 'pedro.s',  fullName: 'Pedro Solano',    role: 'jefe_operaciones' },
    ],
    drivers: [
      { name: 'Sofía Torres',   department: 'Ventas' },
      { name: 'Diego Rivas',    department: 'Mantenimiento' },
    ],
    vehicles: [
      { plate: 'SV-P-001-A', vehicleType: 'Sedán',     brand: 'Honda',  model: 'Civic',    year: 2022 },
      { plate: 'SV-P-002-B', vehicleType: 'Camioneta', brand: 'Toyota', model: 'Land Cruiser', year: 2021 },
      { plate: 'SV-P-003-C', vehicleType: 'Camión',    brand: 'Hino',   model: '300',      year: 2020 },
    ],
  },
  {
    countryCode: 'NI',
    staff: [
      { username: 'pedro.m',  fullName: 'Pedro Martínez', role: 'guardia' },
      { username: 'rosa.f',   fullName: 'Rosa Flores',    role: 'jefe_operaciones' },
    ],
    drivers: [
      { name: 'Alejandro Ortiz',  department: 'Operaciones' },
      { name: 'Patricia Luna',    department: 'Administración' },
    ],
    vehicles: [
      { plate: 'NI-A-001-X', vehicleType: 'Pick-up',   brand: 'Mitsubishi', model: 'L200',    year: 2023 },
      { plate: 'NI-A-002-Y', vehicleType: 'Camioneta', brand: 'Toyota',     model: 'Prado',   year: 2022 },
      { plate: 'NI-A-003-Z', vehicleType: 'Camión',    brand: 'Mercedes',   model: 'Actros',  year: 2021 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolves branch and country IDs from the DB, keyed by country code. */
async function loadBranchIndex(): Promise<Map<string, { branchId: number; countryId: number }>> {
  const req = getConn();
  const result = await req.query<{ CountryCode: string; BranchId: number; CountryId: number }>(`
    SELECT c.Code AS CountryCode, b.Id AS BranchId, c.Id AS CountryId
    FROM   Branches b
    JOIN   Countries c ON c.Id = b.CountryId
    WHERE  b.Active = 1
  `);
  const index = new Map<string, { branchId: number; countryId: number }>();
  for (const row of result.recordset) {
    index.set(row.CountryCode, { branchId: row.BranchId, countryId: row.CountryId });
  }
  return index;
}

async function upsertUser(
  username: string,
  fullName: string,
  role: UserRole,
  hash: string,
  branchId?: number | null,
  countryId?: number | null,
): Promise<void> {
  const existing = await findUserByUsername(username);
  if (!existing) {
    await createUser({ username, fullName, role, passwordHash: hash, branchId, countryId });
    const scope = branchId ? `branch ${branchId}` : countryId ? `country ${countryId}` : 'global';
    console.log(`   [creado]     ${username.padEnd(14)} (${role}) → ${scope}`);
  } else {
    await updateUser(String(existing.id), { passwordHash: hash });
    console.log(`   [existente]  ${username.padEnd(14)} contraseña restablecida a 1234`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SEED — MULTI-SUCURSAL (PA · GT · SV · NI)                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await getPool(); // inicializa el pool antes de withScriptContext

  const PIN  = '1234';
  const hash = await bcrypt.hash(PIN, 12);

  await withScriptContext(async () => {
    // ── 1. Administrador global ─────────────────────────────────
    console.log('1. Admin global');
    await upsertUser(GLOBAL_ADMIN.username, GLOBAL_ADMIN.fullName, GLOBAL_ADMIN.role, hash);

    // ── 2. Admins por país ──────────────────────────────────────
    console.log('\n2. Admins por país (admin_pais)');
    const branchIndex = await loadBranchIndex();

    for (const ca of COUNTRY_ADMINS) {
      const entry = branchIndex.get(ca.countryCode);
      if (!entry) {
        console.log(`   [omitido] país ${ca.countryCode} no encontrado en DB`);
        continue;
      }
      await upsertUser(ca.username, ca.fullName, 'admin_pais', hash, null, entry.countryId);
    }

    // ── 3. Personal, conductores y vehículos por sucursal ───────
    for (const branch of BRANCHES) {
      const entry = branchIndex.get(branch.countryCode);
      if (!entry) {
        console.log(`\n[omitido] sucursal ${branch.countryCode} no encontrada`);
        continue;
      }
      const { branchId } = entry;
      const scope: TenantScope = { kind: 'branch', branchId };

      console.log(`\n3.${branch.countryCode} — Sucursal ${branch.countryCode}-CENTRAL (branchId=${branchId})`);

      // Personal de garita
      console.log('   Usuarios:');
      for (const u of branch.staff) {
        await upsertUser(u.username, u.fullName, u.role, hash, branchId);
      }

      // Conductores
      console.log('   Conductores:');
      const existingDrivers = await getActiveDrivers(scope);
      if (existingDrivers.length === 0) {
        for (const d of branch.drivers) {
          await createDriver({ name: d.name, department: d.department, branchId });
          console.log(`   [creado]     conductor: ${d.name}`);
        }
      } else {
        console.log(`   [omitido]  ya existen ${existingDrivers.length} conductor(es)`);
      }

      // Vehículos
      console.log('   Vehículos:');
      const existingVehicles = await getActiveVehicles(scope);
      if (existingVehicles.length === 0) {
        for (const v of branch.vehicles) {
          await createVehicle({ branchId, ...v });
          console.log(`   [creado]     ${v.plate} · ${v.brand} ${v.model} ${v.year}`);
        }
      } else {
        console.log(`   [omitido]  ya existen ${existingVehicles.length} vehículo(s)`);
      }
    }
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  SEED COMPLETADO                                            ║');
  console.log('║                                                             ║');
  console.log('║  PIN universal: 1234                                        ║');
  console.log('║  admin_global  → admin                                      ║');
  console.log('║  admin_pais PA → admin.pa   (solo ve PA)                    ║');
  console.log('║  admin_pais GT → admin.gt   (solo ve GT)                    ║');
  console.log('║  admin_pais SV → admin.sv   (solo ve SV)                    ║');
  console.log('║  admin_pais NI → admin.ni   (solo ve NI)                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await closePool();
  process.exit(0);
}

main().catch(async err => {
  console.error('\n[ERROR]', err.message ?? err);
  await closePool();
  process.exit(1);
});
