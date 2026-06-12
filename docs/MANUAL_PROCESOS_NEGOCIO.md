# Manual de Procesos de Negocio y Operación
## Sistema de Inspección Vehicular — ConstruMarket

Este documento describe de manera clara, no técnica, cómo opera y se gestiona el sistema de control de flota vehicular interna (especialmente de camionetas pickup) en **ConstruMarket**. Está diseñado para servir como guía de inducción, auditoría operativa y alineación de procesos para el personal de operaciones, jefaturas y auditoría interna.

---

## 1. Contexto de Negocio y Objetivo del Sistema

ConstruMarket se dedica a la venta, alquiler y servicio de maquinaria pesada. Para soportar estas operaciones en campo, los trabajadores y técnicos utilizan una flota de camionetas pickup institucionales. Al finalizar las jornadas de trabajo, los vehículos retornan a las instalaciones de la empresa.

El **objetivo del sistema** es registrar en caliente (en tiempo real), de forma ágil y segura, el estado físico y operativo de cada vehículo al ingresar por la garita. Este control previene el fraude, asegura el mantenimiento oportuno de la flota, garantiza que las herramientas de seguridad obligatorias estén completas y optimiza el flujo de trabajo de la siguiente manera:

1. **Vigilancia proactiva:** Detección inmediata de daños externos o internos.
2. **Control de inventario:** Monitoreo del kit de herramientas y seguridad.
3. **Mantenimiento preventivo:** Control de uso mediante lecturas fiables del odómetro (kilometraje).
4. **Continuidad operativa:** Facilidad de uso para el vigilante con pantallas táctiles grandes, entrada simplificada por PIN y capturas de cámara directas.

---

## 2. Estructura Organizativa (Roles del Sistema)

Para garantizar la segregación de funciones y la seguridad de la información, el sistema opera con cuatro roles clave:

| Rol | Ubicación Física | Funciones Principales |
|---|---|---|
| **Vigilante / Guardia** | Garita de Ingreso | Registra la inspección física de cada vehículo conforme va llegando. No "abre" ni "envía" turnos: cada registro se guarda al instante y el sistema le asigna el turno según la hora local. |
| **Jefe de Operaciones** | Oficina de Sucursal | Monitorea la operación de su sucursal (incluido el monitor de vehículos no vistos), gestiona los reportes de daños (**Problemas Abiertos**) y puede corregir inspecciones de turnos cerrados con justificación obligatoria. |
| **Administrador de País** | Sede Regional | Monitorea y audita todas las sucursales asignadas a su país (Panamá, Guatemala, El Salvador o Nicaragua). |
| **Administrador Global** | Sede Central | Configura el sistema a nivel general, administra usuarios de todos los países y gestiona los parámetros globales de control. |

---

## 3. Turnos de Trabajo

La operación está organizada en tres turnos diarios. El sistema detecta automáticamente el turno activo según la hora local de la sucursal — el vigilante **no necesita seleccionarlo manualmente**.

| Turno | Horario predeterminado | Configurable |
|---|---|---|
| Mañana | 06:00 – 13:59 | Sí, por país |
| Tarde | 14:00 – 21:59 | Sí, por país |
| Noche | 22:00 – 05:59 | Sí, por país |

> Los horarios predeterminados aplican a toda la organización. Si las operaciones de un país requieren horarios distintos (por regulación laboral local u horario operativo diferente), el Administrador de País puede ajustarlos para todas las sucursales de ese país. Los horarios de turno son **uniformes dentro de un mismo país**: no es posible que una sucursal use horarios distintos a las demás del mismo país, ya que esto rompería la consistencia de los reportes regionales.

> **Turno noche y cambio de fecha:** El turno noche que inicia el día 3 a las 22:00 sigue siendo "noche" durante la madrugada del día 4. Como cada inspección se estampa con su fecha y turno local al momento de registrarse, el cruce de medianoche se maneja solo — no hay ninguna sesión que "expire".

---

## 4. Modelo de Registro: Stream de Eventos (sin sesiones)

> **Cambio de modelo (v2.0):** El sistema ya **no** funciona con sesiones de turno que se abren y se envían. Cada inspección es un **evento autocontenido** que se guarda en el momento, estampado con la sucursal, la fecha local, el turno (calculado por la hora) y el guardia que lo registró. **No existe "enviar reporte" ni registro obligatorio de toda la flota.**

Hay dos conceptos de estado, separados a propósito:

**A) Estado de la inspección** (el evento puntual del turno):

| Estado | Significado |
|---|---|
| **Sin novedad** | Vehículo recibido, sin daños ni observaciones. |
| **Con observaciones** | Recibido con detalles menores (sucio, observado). |
| **Daño / faltante** | Recibido con daño grave o herramienta faltante → genera Problema Abierto. |
| **No retornó** | El guardia registra que el vehículo no regresó hoy (razón desconocida). |
| **Otro** | Cualquier otra razón puntual justificada. |

**B) Estado persistente del vehículo** (dura entre turnos hasta que cambie):

| Estado | Significado |
|---|---|
| **En circulación** | Operación normal; se espera que pase por la garita. |
| **En taller / Servicio nocturno / Fuera del país / Autorización especial** | El vehículo está ausente de forma duradera. Vive en el vehículo, **no se re-registra cada turno**. Al recibirlo físicamente vuelve a "En circulación" automáticamente. |

**Sellado por cambio de turno:** mientras dure su turno, el guardia puede corregir libremente lo que registró. Cuando entra el siguiente turno, las inspecciones del turno anterior quedan **selladas**: solo un supervisor puede modificarlas, y siempre con justificación que queda en la bitácora de auditoría.

---

## 5. Flujo de Procesos Operativos (Paso a Paso)

```
   ┌───────────────────────────┐
   │ 1. Inicio de sesión       │ -> PIN; el sistema muestra la flota y el turno actual
   └─────────────┬─────────────┘
                 ▼
   ┌───────────────────────────┐
   │ 2. Registro en Garita     │ -> Cada vehículo se inspecciona y guarda al instante
   └─────────────┬─────────────┘
                 ▼
   ┌───────────────────────────┐
   │ 3. Monitor de no vistos   │ -> El jefe ve qué vehículos activos faltan por inspeccionar
   └─────────────┬─────────────┘
                 ▼
   ┌───────────────────────────┐
   │ 4. Gestión de Daños       │ -> Supervisor coordina mantenimiento y cierra alertas
   └─────────────┬─────────────┘
                 ▼
   ┌───────────────────────────┐
   │ 5. Bitácora de Auditoría  │ -> Registro inmutable de correcciones de turnos cerrados
   └───────────────────────────┘
```

---

### Fase 1: Inicio de sesión del Vigilante

**Quién lo hace:** El Vigilante.

**Procedimiento:**

1. El vigilante ingresa con su usuario y su **PIN numérico de 4 dígitos**.
2. El sistema muestra de inmediato la flota de vehículos activos de la sucursal y el **turno actual**, calculado automáticamente por la hora local. No hay que "iniciar" nada.
3. Cada vehículo aparece con su estado de este turno: **Sin revisar**, **Revisado** (si ya se registró en el turno actual) o con su **estado persistente** (en taller, fuera del país, etc.).
4. Cualquier vigilante de la sucursal puede registrar vehículos en el turno actual (kiosco compartido). El sistema graba qué guardia registró cada evento.

> **No hay apertura, envío, reanudación ni descarte de turno.** El trabajo del guardia es simplemente registrar los vehículos que van llegando; cada registro se guarda solo.

---

### Fase 2: Inspección Física e Ingreso en Garita

**Quién lo hace:** El Vigilante al ingresar un vehículo físicamente.

**Procedimiento:**

Cuando una camioneta llega a la garita, el vigilante la selecciona en su pantalla y completa un formulario táctil dividido en bloques lógicos:

1. **Identificación del Conductor:** El guardia selecciona al conductor de una lista precargada. Si es un tercero o personal externo, selecciona "Otro" e ingresa el nombre a mano.

2. **Estado de Retorno:** Selecciona cómo ingresa el vehículo:
    - **Recibido físicamente:** Dispara el flujo de inspección completa (detallado abajo).
    - **Estados Especiales (Excepciones):** Si el vehículo no ingresará. Al marcar uno de estos, **el sistema reduce la inspección a solo los campos mínimos necesarios**, solicitando quién autorizó la ausencia y la fecha estimada de retorno.

    | Estado | Descripción |
    |---|---|
    | Recibido | Vehículo ingresa físicamente a la garita → inspección completa |
    | No retornó | No regresó, razón desconocida |
    | En taller | Ingresado a mantenimiento |
    | Servicio nocturno | Salió en operación nocturna |
    | Fuera del país | Desplazamiento internacional |
    | Autorización especial | Ausencia con autorización específica registrada |
    | Otro | Cualquier otra razón justificada |

3. **Control del Odómetro (Kilometraje) — Filtro Antifraude** *(solo para vehículos recibidos físicamente)*:
    - El vigilante ingresa el kilometraje actual que muestra el tablero.
    - El sistema compara la cifra ingresada con la última lectura registrada.
    - **Alerta de Kilometraje Menor:** Si el guardia digita un kilometraje inferior al anterior, el sistema bloquea el flujo y exige corrección o justificación escrita obligatoria.
    - **Alerta de Uso Inusual:** Si la diferencia supera el umbral configurado (por defecto 500 km/día), el sistema emite una advertencia visual que el guardia debe confirmar con justificación escrita.

4. **Combustible y Limpieza** *(solo vehículos recibidos)*: Evaluación visual del nivel de combustible (Vacío, 1/4, 1/2, 3/4, Lleno) y del aseo general (Limpio, Aceptable, Sucio, Muy sucio).

5. **Chequeo de Kit de Herramientas y Seguridad** *(solo vehículos recibidos)*: El vigilante evalúa el kit obligatorio que debe portar la camioneta marcando para cada ítem: *OK*, *Falta*, *Dañado* o *N/A*.

6. **Inspección de Daños Externos e Internos** *(solo vehículos recibidos)*: Si la camioneta tiene afectaciones, el guardia registra las zonas dañadas. Si no hay daños, marca "Sin daños visibles".

7. **Evidencia Fotográfica:**
    - El vigilante puede tomar fotos del odómetro o de las zonas afectadas directamente desde la tablet.
    - Si se registran daños o herramientas faltantes, **las fotos de evidencia son obligatorias** según configuración de la sucursal.
    - Las fotos se almacenan en el servidor de forma segura y solo son accesibles a través del sistema (no como archivos públicos).

8. **Generación Automática de Problemas Abiertos:** Si el guardia registra un daño grave o herramienta faltante, el sistema crea automáticamente un **Problema Abierto** asociado al vehículo. Esto ocurre una sola vez por inspección — re-guardar la misma inspección no duplica el problema.

**Nota sobre vehículos que regresan entre turnos:**

- Si un vehículo estaba ausente en el turno anterior y regresa durante el turno actual, el guardia simplemente lo selecciona en el dashboard y actualiza su estado a "Recibido" llenando la inspección completa. El sistema actualiza el registro en tiempo real.

---

### Fase 3: Monitor de Completitud (control suave, no bloqueante)

**Quién lo usa:** El Jefe de Operaciones / Supervisor.

En el modelo de stream **no hay envío de reporte ni bloqueo por vehículos pendientes**. El registro completo de la flota deja de ser una barrera impuesta al guardia y pasa a ser un **monitor calculado** del lado de supervisión:

1. El sistema calcula en tiempo real los **vehículos "no vistos"**: aquellos en estado "En circulación" que no tienen ninguna inspección en las últimas **N horas** (configurable por sucursal mediante `unseen_alert_hours`, por defecto 8h).
2. Este monitor aparece en el Centro de Operaciones. El guardia nunca se bloquea; el supervisor decide si algún vehículo no visto requiere seguimiento.
3. Los vehículos con estado persistente (taller, fuera del país, etc.) se excluyen del monitor: no se espera que pasen por la garita.

> **Por qué este cambio:** el antiguo bloqueo de envío garantizaba que toda la flota tuviera estado al cerrar el turno, pero introducía fricción y lógica frágil. El monitor preserva el control antifraude (detectar vehículos sin registrar) sin frenar al guardia.

---

### Fase 4: Gestión de Daños y Mantenimiento (Seguimiento)

**Quién lo hace:** El Jefe de Operaciones / Supervisor de Sucursal.

**Procedimiento:**

1. **Alertas Automáticas:** Si durante la inspección el vigilante registró un daño grave o una herramienta faltante, el sistema genera automáticamente un **Problema Abierto** asociado a ese vehículo.
2. **Bloqueo Visual:** La camioneta queda marcada con un ícono de advertencia en el dashboard para alertar a los siguientes turnos.
3. **Coordinación de Mantenimiento:** El Jefe de Operaciones visualiza los Problemas Abiertos, coordina el ingreso al taller o la reposición de la herramienta, y registra las acciones tomadas.
4. **Cierre de Alerta:** Una vez solucionado, el Jefe de Operaciones cierra el caso en el sistema con una observación final. Esto limpia la alerta del vehículo.

**Ciclo de vida de un Problema Abierto:**

```
[Abierto] → [En proceso] → [Resuelto]
                         → [Desestimado]
```

---

### Fase 5: Control de Cambios y Auditoría (Seguridad Operativa)

**Quién lo hace:** El Jefe de Operaciones e Inspectores de Auditoría Interna.

**Procedimiento:**

1. En ocasiones excepcionales, se requiere corregir un dato de un reporte ya enviado (ej. un guardia digitó mal un odómetro).
2. El vigilante no puede editarlo. El **Jefe de Operaciones** es el único facultado para entrar en modo de edición de una inspección ya enviada.
3. **Motivo Obligatorio:** El sistema despliega un formulario donde el supervisor debe escribir el motivo exacto de la corrección antes de guardar.
4. **Historial Inmutable:** Cada corrección posterior al envío se registra automáticamente en la bitácora de auditoría (`AuditLogs`) con: usuario que hizo el cambio, fecha y hora exactas, valor anterior, valor nuevo y justificación. Esto previene colusiones para ocultar siniestros o pérdidas de herramientas.

---

## 6. Aislamiento por País y Sucursal (Multi-Sucursal)

El sistema opera en múltiples países y sucursales de forma simultánea con aislamiento estricto de datos:

| País | Zona Horaria |
|---|---|
| Panamá | America/Panama (UTC-5) |
| Guatemala | America/Guatemala (UTC-6) |
| El Salvador | America/El_Salvador (UTC-6) |
| Nicaragua | America/Managua (UTC-6) |

Todas las fechas y horas en el sistema se calculan y muestran en la hora **local de la sucursal**, no en la hora del servidor. Esto garantiza que un reporte de Guatemala refleje la fecha guatemalteca, aunque el servidor esté en otro huso horario.

**Reglas de aislamiento:**
- Un vigilante de Guatemala no puede ver ni modificar datos de El Salvador.
- Un Jefe de Operaciones solo accede a su sucursal.
- Un Administrador de País accede a todas las sucursales de su país, sin cruzar fronteras.
- Solo el Administrador Global tiene visibilidad completa de todos los países.

---

## 7. Configuraciones del Sistema

### 7.1 Jerarquía de configuración

El sistema organiza sus parámetros en tres niveles jerárquicos. Cada nivel hereda automáticamente los valores del nivel superior, y puede ajustar (cuando el parámetro lo permite) el valor para su ámbito sin afectar a los demás.

```
Global (toda la organización)
    └─ País  (todas las sucursales de ese país)
         └─ Sucursal  (esa sucursal en particular)
```

**Principio de herencia:** Si una sucursal no tiene un valor propio para un parámetro, toma el de su país. Si el país tampoco tiene uno propio, toma el global. Si se elimina el ajuste local ("restablecer"), el nivel inferior recupera automáticamente el valor del nivel superior — nunca queda vacío.

**Parámetros uniformes:** Algunos parámetros no se pueden ajustar por debajo de un cierto nivel porque deben ser iguales en todo el ámbito. Por ejemplo, los horarios de turno son uniformes por país: no es válido que una sucursal use horarios distintos a las demás del mismo país.

---

### 7.2 Quién puede configurar qué

| Rol | Puede ajustar | Alcance |
|---|---|---|
| **Administrador de Sucursal** | Parámetros de nivel sucursal | Solo su propia sucursal |
| **Administrador de País** | Parámetros de nivel sucursal y de país | Cualquier sucursal y la configuración de su país |
| **Administrador Global** | Todos los parámetros en cualquier nivel | Toda la organización |

El Jefe de Operaciones y el Vigilante **no pueden modificar ningún parámetro de configuración**.

---

### 7.3 Catálogo de parámetros

#### Parámetros de sucursal

*Cada sucursal puede tener un valor propio. Si no lo tiene, hereda del país o del global.*

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| Umbral de kilometraje inusual | 500 km/día | Diferencia máxima de km entre lecturas consecutivas antes de emitir alerta de uso inusual |
| Días sin revisión (alerta) | 3 días | Días transcurridos sin inspección registrada antes de marcar el vehículo como prioritario en reportes |
| Horas para alerta "no visto" | 8 h | Horas sin inspección antes de que el vehículo "En circulación" aparezca en el monitor de no vistos del supervisor |
| Foto obligatoria en daño | Activado | Exige evidencia fotográfica cuando el guardia reporta daños en la inspección |
| Foto obligatoria en faltante | Desactivado | Exige foto cuando el guardia reporta herramienta faltante |
| Edición por guardia antes del sello | Activado | Permite al guardia corregir sus registros mientras el turno sigue activo |

#### Parámetros de país

*Uniformes para todas las sucursales del país. Ninguna sucursal puede tener un valor distinto al de su país.*

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| Inicio de turno Mañana | 06:00 | Hora local de inicio del turno mañana (formato 24h) |
| Inicio de turno Tarde | 14:00 | Hora local de inicio del turno tarde (formato 24h) |
| Inicio de turno Noche | 22:00 | Hora local de inicio del turno noche (formato 24h) |
| Primer día de la semana en reportes | Lunes | Día con el que inicia la semana al agrupar reportes semanales |

> **Restricción de orden:** el sistema exige que Mañana < Tarde < Noche. No es posible guardar una combinación de horarios que invierta este orden.

#### Parámetros globales

*Uniformes en toda la organización. Solo el Administrador Global puede cambiarlos.*

| Parámetro | Valor por defecto | Descripción |
|---|---|---|
| Retención de bitácora de auditoría | 365 días | Tiempo mínimo que se conservan los registros de auditoría antes de poder depurarse. Aplica igual en todos los países. |
| Tamaño máximo de foto | 10 MB | Límite de peso por fotografía subida en una inspección. El Administrador Global puede fijar un valor distinto por país si las condiciones de conectividad lo requieren. |

---

### 7.4 Auditoría de cambios de configuración

Cada vez que un administrador modifica o restablece un parámetro, el sistema registra automáticamente en la bitácora de auditoría:

- Quién realizó el cambio (usuario y nombre completo)
- Qué parámetro se modificó
- El valor anterior y el valor nuevo
- El nivel al que se aplicó el cambio (sucursal, país o global)
- Fecha, hora y dirección IP desde donde se realizó

Esto garantiza trazabilidad completa de cualquier ajuste operativo, coherente con la misma política de inmutabilidad que rige las correcciones de inspecciones.

---

## 8. Resumen de Reglas de Control Críticas (Invariantes del Negocio)

El sistema hace cumplir estas reglas de forma automática e inflexible:

**Reglas de turno e inspección (modelo stream):**
- **El turno es asignado por el sistema.** El vigilante no selecciona el turno — se estampa en cada inspección según la hora local de la sucursal al registrarla.
- **Cada inspección es un evento autocontenido.** No hay sesión que abrir, enviar, reanudar ni descartar. El registro se guarda al instante.
- **Acceso compartido.** Cualquier vigilante de la sucursal puede registrar vehículos en el turno actual (kiosco compartido); el sistema graba qué guardia registró cada evento.
- **Sellado por cambio de turno.** Mientras dure su turno el guardia corrige libremente; al cambiar el turno, sus inspecciones quedan selladas y solo un supervisor puede modificarlas con justificación.
- **Completitud por monitor, no por bloqueo.** No se exige registrar toda la flota. El sistema marca para el supervisor los vehículos "En circulación" no vistos en las últimas N horas.

**Reglas de inspección:**
- **Regla de Integridad Física:** Todo reporte de daños o herramientas faltantes exige observaciones detalladas y registro fotográfico (según configuración de la sucursal).
- **Regla de Consistencia de Odómetro:** El kilometraje nuevo nunca puede ser menor al anterior sin disparar una alerta que exige justificación escrita obligatoria.
- **Un problema abierto por detección.** Si el guardia guarda la misma inspección con daño varias veces, el sistema crea el Problema Abierto solo la primera vez.

**Reglas de seguridad y datos:**
- **Regla de Auditoría Inmutable.** Ningún dato enviado puede ser modificado sin dejar una huella digital con responsable, cambio realizado y justificación.
- **Regla de Aislamiento Geográfico.** Un usuario solo puede visualizar y alterar información de su sucursal o país asignado.
- **Regla de Autoría por Evento.** Cada inspección registra qué guardia la creó. La autoría es por evento, no por turno.

---

## 9. Flujo Completo de un Turno (Diagrama de Decisión)

```
Guardia ingresa con su PIN
        │
        ▼
El sistema muestra la flota y el turno actual
(calculado por la hora local — sin "abrir" nada)
        │
        ▼
Llega un vehículo a la garita
        │
        ├─ Recibido físicamente ──► Inspección completa ──► se guarda al instante
        │                                                   (estampado: fecha+turno+guardia)
        │                                                   · si estaba ausente, vuelve a "En circulación"
        │
        ├─ No retornó / Otro ─────► Evento puntual del turno ──► se guarda
        │
        └─ Taller / Fuera del país / etc. ──► Estado persistente del vehículo
                                              (no se repite cada turno)
        │
        ▼
Al cambiar el turno, las inspecciones quedan selladas
(solo supervisor puede corregirlas, con justificación → auditoría)
        │
        ▼
Jefe de Operaciones:
 · Monitor de "no vistos" (control suave de completitud)
 · Gestiona Problemas Abiertos
 · Exporta reportes por fecha/turno
```
