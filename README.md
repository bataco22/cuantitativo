# Centro Quant v6.3 · Semáforo inteligente

Versión con radar Top 100 con motor de score explicable, simulador, diario y semáforo de decisión.

## Semáforo
- Verde: score de 85 o más y sin factores técnicos críticos.
- Amarillo: score de 70 a 84 o confirmación incompleta.
- Rojo: score menor de 70; no operar.

El semáforo valida la lectura técnica. Toda operación debe comprobar además entrada, stop, tamaño de posición y relación riesgo/beneficio mínima de 1:3 en el simulador.

## Publicación
Sube todos los archivos y carpetas a la raíz del repositorio de GitHub Pages. El caché v6.3.0 fuerza la actualización desde versiones anteriores.

## v6.5.1
- Inicio permite cambiar el Score entre 15m, 1h, 4h, 1D y 1W.
- El Score de Inicio siempre muestra explícitamente la temporalidad usada.
- La temporalidad elegida se conserva localmente y se usa al abrir análisis o preparar una prueba.
- Se añadieron 15m y 1h al análisis y al simulador de pruebas para mantener consistencia.


## v6.5.1
- Botón **Crear respaldo completo** en Sistema.
- Botón **Cargar respaldo** para migrar datos entre versiones/dispositivos.
- El respaldo incluye todas las claves locales de Centro Quant (`quant_*`), incluidas operaciones de Pruebas, activos, pesos y temporalidad de Inicio.


## v6.6.0
- Backtest automático usando el Score real de Centro Quant, con Long/Short y umbral configurable.
- Temporalidades 15m, 1h, 4h, 1D y 1W en laboratorio.
- Paper trading automático sobre favoritos cuando la PWA está abierta y al reabrir/actualizar.
- Stop, objetivo, riesgo, capital y Score mínimo configurables.
- Evita duplicar una señal de la misma vela y conserva todo en el respaldo local.


## v6.7
- Paper trading automático escanea Top 100 por capitalización (ranking público CoinGecko).
- Excluye stablecoins y exige par USDT activo en Binance.
- Filtro de liquidez mínima antes de descargar velas.
- Evalúa Long y Short, Score mínimo y R/B >= 1:3.
- Favoritos se conservan independientes del radar.

## v6.8.7 — comparación prospectiva de salidas
Las operaciones nuevas conservan la salida actual 1:3 y, sobre la misma entrada y las mismas velas, simulan en paralelo dos salidas virtuales: Escalera y Trailing 0.25R. No cambia la lógica de señales ni el riesgo inicial. Las salidas virtuales continúan siendo monitorizadas aunque la salida actual ya haya cerrado, para permitir que la Escalera supere 3R. Con velas OHLC, cuando el orden intravela es desconocido se usa un criterio causal conservador: primero se evalúa el stop ya activo al inicio de la vela y después se activan nuevos escalones.


## v6.9.0 — Laboratorio QRA prospectivo
- Mantiene Centro Quant original como control.
- Cada nueva operación registra el régimen diario de BTC con regla causal de cierre previo vs 3 cierres anteriores.
- QRA-01 marca como BLOQUEADO todo SHORT cuando BTC está ALCISTA, sin borrar ni impedir la operación de control.
- Compara virtualmente QRA-01 + salida actual, QRA-01 + Escalera y QRA-01 + Trailing 0.25R.
- QRA-03 registra la concentración de señales en la misma dirección sin imponer todavía un límite de riesgo.
- La muestra QRA comienza al instalar/abrir esta versión y no reetiqueta operaciones históricas.


## v6.9.1 — variante Solo LONG
- Añade una cartera virtual prospectiva “Solo LONG”: acepta todas las señales LONG y rechaza todas las SHORT.
- No modifica ni impide las operaciones del Centro Quant original.
- Se muestra en el Laboratorio QRA junto con Control CQ y QRA-01.
- La decisión Solo LONG queda guardada en cada nueva operación y también se exporta al CSV.
- Las operaciones QRA existentes sin el nuevo campo se interpretan por su dirección para mantener continuidad de la muestra fuera de entrenamiento.


## v6.9.2 — vista de operaciones QRA
Añade una vista desplegable en Pruebas para inspeccionar cada operación nueva del laboratorio: Control, Solo LONG, QRA-01, Escalera, Trailing y observación QRA-03. No modifica las reglas ni el motor original.
