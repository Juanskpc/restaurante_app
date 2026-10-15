# Auditoría UX — pantalla Cocina (KDS)

Fecha: 2026-10-15 · Auditor: sesión admin-app-e4 (solo lectura) · Alcance: `cocina.{html,scss,ts}`
tal como estaban a media tarde del 15-oct (con el refactor de columnas `COLUMNAS` ya hecho).

**Método.** Revisión del código y medición de los colores, **sin navegador**: Nicolás tiene una
regla fija de aprobar él mismo cada uso de Chrome (gasta muchos créditos), y un permiso que llega
de otra sesión no la sustituye. Por eso los anchos son cálculos sobre el CSS del layout, no
capturas. Si Nicolás lo aprueba, una pasada visual en 1024 / 390 px confirmaría los puntos
1, 2 y 9.

Contrastes calculados con la fórmula WCAG 2.x sobre los `color-mix` reales del SCSS (tema claro,
superficie `#fff`, texto `#0F0A2A`).

---

## Prioridad ALTA

### 1. En la tablet (1024 px) el tablero NO cabe y aparece scroll lateral
- **A quién:** a todos los cocineros en el dispositivo principal.
- **Evidencia:** a 1024 px el menú lateral está **abierto (240 px)** (`layout.scss`, regla
  `min-width: 1024px`) y `.content` pone 32 px a cada lado → quedan **~720 px**. Las columnas piden
  `3 × 300 + 2 × 16 = 932 px`. Resultado: se ven dos columnas y media y «Listo» queda fuera. Entre
  768 y 1023 px (riel de 64 px) tampoco cabe hasta ~1060 px.
- **Propuesta:**
  - Bajar el mínimo: `grid-template-columns: repeat(3, minmax(220px, 1fr))` (a 720 px da 229 px
    por columna; con la densidad compacta es suficiente).
  - Y/o que Cocina pida el menú plegado por defecto en ≥1024 px (es una pantalla de pared, el menú
    sobra). Si el layout tiene la señal `is-colapsado`, que la ruta `/cocina` la arranque en true.
  - Reservar el scroll con snap solo para `< 680px`, que es donde se diseñó.

### 2. Doble toque y «botón que se corre»: se puede avanzar la comanda equivocada
- **A quién:** cocinero con prisa / guantes / pantalla mojada.
- **Evidencia:** `cambiarEstado()` lanza el PATCH sin bloquear nada y la tarjeta sigue en su sitio
  ~1 s. Al llegar `loadOrdenes()` la tarjeta desaparece y **la siguiente sube justo debajo del
  dedo**: un segundo toque (muy común si «no pasó nada») avanza **otra** comanda. Además, el doble
  toque sobre la misma manda dos PATCH y, en «Marcar como listo», **dos campanazos**.
- **Propuesta (encaja con el indicador de carga que ya estás haciendo):**
  - `readonly enCurso = signal<Set<number>>(new Set())`; en `cambiarEstado` salir si el id ya está;
    en el template `[disabled]="enCurso().has(orden.id_orden)"` + `aria-busy` + spinner en el
    botón.
  - **Mover la tarjeta al instante** (actualización optimista: cambiar `estado_cocina` en
    `ordenes` antes del PATCH) y revertir si falla. Así el feedback es inmediato.
  - **Bloqueo anti-rebote de la columna**: tras mover una tarjeta, ignorar toques en los botones
    de esa columna durante ~400 ms (`pointer-events: none` con una clase temporal). Es lo que evita
    el «botón que se corre».

### 3. Si el cambio falla, nadie se entera (y suena la campana igual)
- **A quién:** cocina y meseros (creen que está listo y no lo está).
- **Evidencia:** `playSound()` se ejecuta **antes** del PATCH; el `subscribe` solo tiene `next`.
  Con red caída o un 403/409: suena «listo», la tarjeta no se mueve y no hay mensaje.
- **Propuesta:** sonar en `next`, no antes; en `error`, revertir el optimista y mostrar un aviso
  visible en la tarjeta (franja roja «No se pudo mover — toca para reintentar») o el toast global
  de la app. Nunca silencio.

### 4. «Entregar» no tiene deshacer
- **A quién:** cocinero que toca la tarjeta equivocada en «Listo».
- **Evidencia:** en Pendiente/Preparación/Listo hay botón de devolver, pero `ENTREGADO` saca la
  comanda del tablero y ya no hay forma de traerla desde Cocina.
- **Propuesta:** barra inferior de 6 s «#0056 entregada · **Deshacer**» (botón ≥44 px) que hace
  PATCH a `LISTO`. Mismo patrón que Gmail; no pide confirmación (que estorba con prisa) pero
  permite corregir. Vale también para los demás avances, y entonces el ícono pequeño de deshacer
  de la tarjeta podría desaparecer (ver 11).

### 5. El tablero no avisa cuando se queda sin conexión ni cuando falla la primera carga
- **A quién:** cocina en hora pico con wifi inestable.
- **Evidencia:** el `error` de `loadOrdenes()` solo apaga `cargando`. (a) Si falla la **primera**
  carga, las tres columnas dicen «Sin comandas nuevas / Nada en el fogón»: es **mentira** y la
  cocina se relaja. (b) Si se cae el SSE o la red más tarde, el tablero queda congelado sin
  ninguna señal.
- **Propuesta:** `readonly sinConexion = signal(false)`; en error → true; en éxito → false. Franja
  ámbar fija bajo el encabezado «Sin conexión — lo que ves puede estar desactualizado
  (hh:mm)». En el primer fallo, en vez del estado vacío, «No se pudieron cargar las comandas ·
  Reintentar». Si `RealtimeService` expone el estado del canal, usarlo también.

### 6. La campana suena para quien no la necesita; la comanda NUEVA llega en silencio
- **A quién:** cocineros (no oyen que entró algo) y meseros (sí necesitan el «listo»).
- **Evidencia:** en Cocina solo suena `sonarPedidoListo()` y lo dispara **el propio cocinero**
  al tocar «Marcar como listo» — se avisa a sí mismo. Una comanda nueva en Pendiente no suena. En
  un KDS el sonido imprescindible es «entró comanda».
- **Propuesta:** al aplicar la lista, si aparece un `id_orden` nuevo en `PENDIENTE` (comparar con
  los ids previos; ignorar la primera carga) → `sonido.sonarNuevoPedido()` (ya existe en el
  servicio). El aviso de «listo» tendría más sentido en Despacho/Mesas, que es donde está quien
  recoge. Mantener el interruptor, y **recordarlo** (hoy `audioActivo` vuelve a «activo» en cada
  recarga; guardarlo en `localStorage` con try/catch).
- Ojo con la nota del propio servicio: tras recargar la pestaña, el primer aviso no suena hasta
  que alguien toque la pantalla. Conviene un aviso discreto «Toca la pantalla para activar el
  sonido» mientras el `AudioContext` esté suspendido.

---

## Prioridad MEDIA

### 7. Letra pequeña para leer a 1–2 m
- **Evidencia:** nombre del plato **16,8 px** (`1.05rem`), adiciones/exclusiones y notas 14 px,
  **mesa/origen 12 px** (`--font-size-xs`), mesero 12 px. Para 1,5 m la referencia de los KDS es
  ≥ 20 px en ítems y ≥ 18 px en modificadores. Solo el número (24 px) y el reloj (16 px/800) se
  ven bien.
- **Propuesta (para la densidad «grande», y subir la normal):**
  - `.product-name` y `.product-qty` → `1.25rem` normal / `1.5rem` grande.
  - `.mod`, `.nota` → `1rem` normal / `1.125rem` grande.
  - **El origen (mesa / llevar / domicilio) es lo segundo más importante después del plato**:
    sacarlo de chip de 12 px y ponerlo al lado del número a `1.125rem` 700
    (`#0056 · Mesa 4`). El mesero puede quedarse pequeño.
  - Cantidades > 1 resaltadas: `.product-qty--varias` con fondo sólido (no pastel) para que «3×»
    no se lea como «1×».

### 8. Exclusiones vs. adiciones: se confunden con daltonismo, y las alergias no existen como tal
- **Evidencia:** «+ Queso» es chip verde y «− Sin cebolla» chip rojo; misma forma, mismo tamaño,
  14 px. Rojo/verde es justo la pareja que no distingue ~8 % de los hombres; el ícono +/− de 14 px
  no basta a 1,5 m. Las notas (donde suelen ir las alergias) son dorado, **el mismo tono que la
  columna «En preparación»** y que el reloj «5–10 min».
- **Propuesta:**
  - Texto que no dependa del color: **«SIN cebolla»** con «SIN» en mayúscula 800 y
    `text-decoration: line-through` en el ingrediente; **«+ EXTRA queso»** / «CON queso». 
  - Forma distinta: exclusión con borde sólido 2 px y fondo blanco; adición pastel sin borde.
  - Alergias: si la nota contiene `alerg|celiac|sin gluten|maní|mani` (insensible a mayúsculas y
    tildes), pintarla como bloque **rojo sólido con texto blanco** y ícono `shield-alert`, y además
    marcar la tarjeta con una franja superior roja. Mejor aún a futuro: un campo `es_alergia` en la
    nota, no adivinar por texto.
  - La nota de toda la comanda va **arriba**, debajo de la cabecera, no al final: se lee antes de
    empezar a cocinar, no después.

### 9. Comandas largas (8 platos): el botón queda fuera de vista
- **Evidencia:** la orden de ejemplo de 8 platos, con adiciones y notas, supera el alto útil de
  una columna en tablet; el botón está al fondo de la tarjeta y hay que desplazar la columna para
  tocarlo, y al volver no se ve qué comanda era.
- **Propuesta:** `.card-footer { position: sticky; bottom: 0; background: var(--color-surface);
  border-radius: 0 0 var(--radius-md) var(--radius-md); }` (funciona dentro de
  `.cards-container`, que ya es el contenedor con scroll). Opcional: platos tachables con un toque
  (`.product-item--hecho`, solo en cliente) para comandas grandes.

### 10. Platos añadidos después a una comanda en marcha no se distinguen
- **Evidencia:** `DetalleItem` trae `fecha_creacion` y `estado` pero el template no los usa. Si el
  mesero añade un plato a una comanda que ya está «En preparación», aparece mezclado con los demás.
- **Propuesta:** si `detalle.fecha_creacion` es > 1 min posterior a `orden.fecha_creacion`, etiqueta
  «NUEVO» (fondo coral sólido, texto blanco) junto al nombre, y que la tarjeta parpadee una vez
  (respetando movimiento reducido).

### 11. Botón de deshacer pequeño y junto al reloj
- **Evidencia:** `.btn-undo` mide **34 × 34 px** (mínimo táctil recomendado 44 px; WCAG 2.2 AA pide
  24 px, así que pasa la norma pero no la práctica con guantes). Está pegado al reloj, que no es
  tocable, así que el riesgo de error es bajo; el problema es acertarle.
- **Propuesta:** 44 × 44 px con área táctil ampliada (`::before { inset: -6px }`) o, si se hace el
  deshacer en barra (punto 4), quitarlo de la tarjeta y moverlo a un menú «⋯».

### 12. Urgencia: todo late igual, y el reloj mide lo que no es
- **Evidencia:** umbrales fijos 5/10/15 min para todos los platos; a partir de 15 min la tarjeta
  late sin parar (`animation: latido 2s infinite`). En hora pico media columna late a la vez: deja
  de ser señal y se vuelve ruido (y anima `box-shadow` en tablets modestas). Además, el reloj de
  «En preparación» cuenta desde que se **creó** la comanda, no desde que se empezó a cocinar.
- **Propuesta:**
  - Latido solo **3 ciclos** al pasar a crítica (`animation-iteration-count: 3`) y luego borde
    rojo fijo de 3 px + cabecera roja. Así el cambio se nota y no satura.
  - Umbrales como variables por negocio a futuro (`tiempo_alerta_min`); hoy, al menos subirlos en
    «En preparación».
  - Mostrar dos tiempos si el backend lo permite: total y «cocinando hace X».

### 13. Contraste: el dorado no llega a AA en texto
| Elemento | Contraste | AA (4,5) |
|---|---|---|
| Reloj dorado «5–10 min» (16 px/800, mezcla 80 %) | **3,27** | ❌ |
| Chip/origen dorado (mezcla 75 %) | 3,63 | ❌ (si se usara) |
| Cabecera «En preparación» (65 % sobre 12 %) | 4,52 | ✅ por los pelos |
| Contador «En preparación» | 4,56 | ✅ por los pelos |
| Reloj naranja «10–15 min» | 4,50 | ✅ justo |
| Rojo, verde, azul domicilio, notas, texto secundario | 5,1 – 11,4 | ✅ |

16 px en negrita **no** cuenta como «texto grande» (hace falta 18,66 px en negrita).
- **Propuesta:** para los textos sobre tono dorado usar mezcla con el texto al **55 %** en vez de
  80/75 % (`color-mix(in srgb, var(--t) 55%, var(--color-text-primary))`), o un token propio
  `--kds-preparando-texto: #7a5600`. Lo mismo para el naranja. El borde de «tarde» (55 % sobre
  blanco = 2,0:1) está por debajo de 3:1 para componentes no textuales: subirlo a 80 % o 2 px.

### 14. En el celular (390 px) no se sabe en qué columna estás
- **Evidencia:** columnas al 86 % con snap; al deslizar se pierde la cabecera de las demás y su
  contador. El encabezado de página se oculta (bien) y solo queda el botón de sonido.
- **Propuesta:** en `< 680px`, una fila de pestañas pegajosa arriba con los tres contadores
  («Pendiente 4 · Preparación 2 · Listo 1») que hace `scrollIntoView` a la columna y se marca sola
  con un `IntersectionObserver`. Usar las clases globales `.ui-filtros/.ui-filtro` o
  `.ui-pestanas` del estándar (`_pestanas.scss`), no estilos propios.

---

## Prioridad BAJA

15. **Colores semánticos usados para otra cosa.** «Para llevar» usa `--color-success` (verde =
    «listo» en esta pantalla) y «Para servir» usa `--color-primary` (la marca, que la decisión
    reserva para botones). Proponer: llevar → gris pizarra o violeta fijo; para servir → un tono
    fijo propio (`--despacho-*` si existe uno para WhatsApp), no la marca.
16. **Rojo sobrecargado:** columna Pendiente, reloj crítico, borde crítico y exclusiones son el
    mismo coral. Con el punto 8 (exclusión con forma propia) se reduce; valorar que la cabecera de
    «Pendiente» sea azul/neutra («nuevo») y dejar el rojo solo para «tarde» — es lo que hacen la
    mayoría de los KDS. Si se quiere mantener la decisión ya tomada, al menos que el rojo crítico
    sea sólido y no pastel para que se distinga del de la columna.
17. **Lectores de pantalla:**
    - Cabecera de columna como `<h2>` y contador con texto: `aria-label="4 comandas"`.
    - Cada `<article>` con `aria-label="Comanda 0056, Mesa 4, hace 12 minutos"`.
    - Una región `aria-live="polite"` oculta que anuncie «Nueva comanda #0057» y los errores del
      punto 3.
    - El botón de sonido con `aria-pressed`.
    - El botón principal incluye el número: `aria-label="Iniciar preparación de la comanda 0056"`
      (hoy diez botones iguales dicen lo mismo).
18. **Teclado:** `.btn-accion`, `.btn-undo` y `.btn-hdr` no tienen `:focus-visible` propio (las
    reglas globales de `_theme.scss` son para `.btn` y otros). Añadir
    `&:focus-visible { outline: none; box-shadow: var(--focus-ring); }`.
19. **Movimiento reducido:** bien resuelto para el latido. Falta para `:active { transform:
    scale(0.98) }` (inocuo) y para el futuro parpadeo de «NUEVO».
20. **Comentario desactualizado** en `cocina.ts`: el docblock dice «Se auto-refresca cada 30 s»
    y ya es por SSE.
21. **Estado vacío:** bien escrito y con tono propio por columna. Sugerencia: en «Pendiente»
    vacío, hacerlo más discreto (sin borde punteado) para que la columna no compita con las que
    sí tienen trabajo.

---

## Lo que ya está bien (no tocar)
- Orden por antigüedad (la más vieja arriba) y reloj que deja de alarmar en «Listo».
- Adiciones dentro de su plato, no como líneas sueltas.
- El tablero no parpadea en cada refresco (fusiona con `aplicarLista`) y la primera carga no dice
  «sin comandas».
- Botón principal de ancho completo y 46 px, con verbo claro por columna.
- Número corto «#0056» en grande.
- `prefers-reduced-motion` ya contemplado en el latido.

## Orden sugerido de trabajo
1 → 2 + 3 (van juntos con el indicador de carga) → 4 → 5 → 6 → 7 + 8 (junto con la densidad) →
9 → 13 → el resto.
