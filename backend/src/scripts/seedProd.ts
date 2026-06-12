import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool, getConn, closePool, withScriptContext } from '../db/connection';
import { createVehicle, getActiveVehicles } from '../db/vehicles';
import { createUser, findUserByUsername } from '../db/users';
import type { TenantScope, UserRole } from '../types';

// La contraseña del superadmin se lee de variable de entorno para no quedar en git.
// Ejecución: ADMIN_PASSWORD=<pass> npm run seed:prod
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('[ERROR] Define ADMIN_PASSWORD como variable de entorno antes de correr este script.');
  process.exit(1);
}

// Datos reales estructurados y limpios
const VEHICLES_TO_SEED = [
  // EL SALVADOR
  { country: 'SV', brand: 'ISUZU', model: 'NQR', plate: 'C-119303', year: 2020, type: 'Camión' },
  { country: 'SV', brand: 'ISUZU', model: 'QRM', plate: 'P-75CD9', year: 2025, type: 'Camión' },
  { country: 'SV', brand: 'ISUZU', model: 'NRM', plate: 'C-138854', year: 2026, type: 'Camión' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'C-120569', year: 2020, type: 'Camión' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-1080AF', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-1077C4', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-10811F', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-1075A7', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-99A70', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-103C31', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-103C74', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-898424', year: 2020, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-10813F', year: 2026, type: 'Pick-up' },
  { country: 'SV', brand: 'ISUZU', model: 'D-MAX', plate: 'P-113EOA', year: 2026, type: 'Pick-up' },

  // GUATEMALA
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-724FXJ', year: 2015, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-509LDY', year: 2026, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-569LJZ', year: 2026, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-570LJZ', year: 2026, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-725FXJ', year: 2015, type: 'Pick-up' },
  { country: 'GT', brand: 'NISSAN', model: 'FRONTIER', plate: 'P-756JNT', year: 2022, type: 'Pick-up' },
  { country: 'GT', brand: 'NISSAN', model: 'FRONTIER', plate: 'P-757JNT', year: 2022, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'D-MAX', plate: 'P-660LDY', year: 2026, type: 'Pick-up' },
  { country: 'GT', brand: 'ISUZU', model: 'QMR', plate: 'C-452CBP', year: 2026, type: 'Camión' },

  // NICARAGUA
  { country: 'NI', brand: 'ISUZU', model: 'D-MAX', plate: 'M400-174', year: 2024, type: 'Pick-up' },
  { country: 'NI', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'M361-444', year: 2023, type: 'Pick-up' },
  { country: 'NI', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'M361-441', year: 2023, type: 'Pick-up' },
  { country: 'NI', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'M248-086', year: 2016, type: 'Pick-up' },
  { country: 'NI', brand: 'ISUZU', model: 'D-MAX', plate: 'M402-178', year: 2024, type: 'Pick-up' },
  { country: 'NI', brand: 'ISUZU', model: 'D-MAX', plate: 'M402-709', year: 2024, type: 'Pick-up' },
  { country: 'NI', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'M361-481', year: 2023, type: 'Pick-up' },
  { country: 'NI', brand: 'ISUZU', model: 'D-MAX', plate: 'M399-502', year: 2024, type: 'Pick-up' },
  { country: 'NI', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'M361-449', year: 2023, type: 'Pick-up' },
  { country: 'NI', brand: 'ISUZU', model: 'CMAG', plate: 'M251-629', year: 2016, type: 'Pick-up' },

  // PANAMA
  { country: 'PA', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'CT4828', year: 2019, type: 'Pick-up' },
  { country: 'PA', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'CT4827', year: 2019, type: 'Pick-up' },
  { country: 'PA', brand: 'MITSUBISHI', model: 'L200', plate: 'AF4208', year: 2014, type: 'Pick-up' },
  { country: 'PA', brand: 'NISSAN', model: 'NP 300 FRONTIER', plate: 'AN6913', year: 2015, type: 'Pick-up' },
  { country: 'PA', brand: 'ISUZU', model: 'IGL7013', plate: 'CS8444', year: 2019, type: 'Pick-up' },
  { country: 'PA', brand: 'ISUZU', model: 'IGL7013', plate: 'CS8438', year: 2019, type: 'Pick-up' },
  { country: 'PA', brand: 'TOYOTA', model: 'LAND CRUISER PRADO', plate: 'EI5223', year: 2023, type: 'Camioneta' }
];

async function seedProductionVehicles() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SEED DE PRODUCCIÓN — VEHÍCULOS REALES Y SUPERADMIN         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    await getPool();

    await withScriptContext(async () => {
      // 1. Obtener los Branch IDs dinámicamente
      console.log('Obteniendo sucursales activas...');
      const req2 = getConn();
      const branchesResult = await req2.query<{ CountryCode: string; BranchId: number }>(`
        SELECT c.Code AS CountryCode, b.Id AS BranchId
        FROM   Branches b
        JOIN   Countries c ON c.Id = b.CountryId
        WHERE  b.Active = 1
      `);

      const branchMap = branchesResult.recordset.reduce((acc: Record<string, number>, row) => {
        acc[row.CountryCode] = row.BranchId;
        return acc;
      }, {});

      console.log('Sucursales encontradas:', branchMap);

      // 2. Crear superadmin
      console.log('\nVerificando/creando usuario Super Admin...');
      const superAdminUser = 'admin';
      const existingAdmin = await findUserByUsername(superAdminUser);

      if (!existingAdmin) {
        const hash = await bcrypt.hash(ADMIN_PASSWORD!, 12);
        await createUser({
          username: superAdminUser,
          fullName: 'Administrador Global',
          role: 'admin_global' as UserRole,
          passwordHash: hash,
          branchId: null,
          countryId: null
        });
        console.log(`[CREADO] Super Admin '${superAdminUser}'.`);
      } else {
        console.log(`[OMITIDO] El usuario '${superAdminUser}' ya existe.`);
      }

      console.log('\nIniciando carga de vehículos...');

      // Optimizacion: cachear los vehiculos existentes por sucursal para no consultar la DB en cada iteración
      const existingVehiclesCache: Record<number, any[]> = {};

      for (const vehicleData of VEHICLES_TO_SEED) {
        const branchId = branchMap[vehicleData.country];

        if (!branchId) {
          console.warn(`[OMITIDO] No se encontró sucursal activa para el país: ${vehicleData.country}`);
          continue;
        }

        const scope: TenantScope = { kind: 'branch', branchId };

        // Cargar vehiculos existentes de la sucursal la primera vez
        if (!existingVehiclesCache[branchId]) {
          existingVehiclesCache[branchId] = await getActiveVehicles(scope);
        }

        const existingVehicles = existingVehiclesCache[branchId];

        // 3. Comportamiento Idempotente: Verificar por placa si ya existe en esa sucursal
        const alreadyExists = existingVehicles.some((ev: any) => ev.plate === vehicleData.plate);

        if (alreadyExists) {
          console.log(`[OMITIDO] Vehículo placa ${vehicleData.plate} (${vehicleData.country}) ya existe.`);
          continue;
        }

        // 4. Crear el vehículo
        await createVehicle({
          branchId,
          plate: vehicleData.plate,
          vehicleType: vehicleData.type,
          brand: vehicleData.brand,
          model: vehicleData.model,
          year: vehicleData.year,
          initialMileage: 0
        });

        console.log(`[CREADO] Vehículo placa ${vehicleData.plate} (${vehicleData.country}) creado exitosamente.`);
      }
    });

    console.log('\n✅ Seed de producción completado con éxito.');

  } catch (error) {
    console.error('\n❌ Error durante la ejecución del seed:', error);
  } finally {
    // Cerrar el pool de conexiones independientemente de si falló o no
    await closePool();
    process.exit(0);
  }
}

seedProductionVehicles();
