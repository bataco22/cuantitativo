# Centro Quant v6.9.8

Extiende exclusivamente el laboratorio histórico Aronson-QRA. No cambia las reglas del paper trading ni la cohorte prospectiva.

## v6.9.8 · Cartera trailing 0.25R con capital limitado
- Guarda para cada salida virtual trailing su `exitAt`, precio teórico de salida y velas mantenidas.
- Conserva la sensibilidad 0.20R, 0.25R, 0.30R, 0.40R y 0.50R.
- Reconstruye la cartera cronológica del trailing 0.25R usando sus propias fechas de cierre, no las del Control.
- Reporta tres escenarios: sin límite, riesgo agregado máximo 10% y máximo 20%, asumiendo 1% de riesgo por posición.
- Si varias señales compiten por capacidad en la misma marca temporal, prioriza Score mayor y después símbolo alfabético para que la selección sea determinista.
- Las señales rechazadas por falta de presupuesto se cuentan y se exportan; no se reescribe el historial ni se optimiza el límite.
- El drawdown de cartera reportado es **realizado a cierres**, no mark-to-market intradía.

**Objetivo:** medir cuánto del edge 1D + trailing 0.25R sigue siendo capturable con una cartera de riesgo limitado antes de considerar cualquier cambio en producción.

# Historial previo · Centro Quant v6.9.7

Añade Backtest Mercado Aronson-QRA sobre la base v6.9.5. No cambia las reglas de trading en producción.

## Nuevo laboratorio histórico
- Top 100 actual con filtros de liquidez de Centro Quant.
- Entrada causal en la apertura de la vela posterior a la señal cerrada.
- Score >=85, stop 3%, objetivo 9%, riesgo 1% congelados.
- Compara Control, Solo LONG, QRA-01, QRA-03 virtual, combinación QRA-01+QRA-03, Escalera, Trailing 0.25R y QRA-01+Trailing.
- Incluye comisiones configurables y benchmark BTC.
- Exporta JSON completo del experimento.

**Limitación:** usa el Top 100 actual; por ello tiene sesgo de supervivencia. Es investigación retrospectiva, no sustituye la cohorte prospectiva Aronson-QRA.

# Centro Quant v6.9.5

Infraestructura prospectiva sobre v6.9.4. No cambia las reglas de entrada/salida del control actual.

## Cambios
- Mantiene congelados Score mínimo 85, stop 3%, objetivo 9%, riesgo 1% y pesos 30/20/15/15/10/10.
- Añade cohorte `ARONSON-QRA-2026-08-22-1` a nuevas operaciones, con versión de estrategia y fecha de congelación.
- Guarda factores individuales del Score, puntos aportados y pesos usados al abrir cada nueva operación.
- Añade compactación de segundo nivel: si tras retirar OHLC cerrado aún no cabe, resume `rPath` de cerradas antiguas y conserva completas las 50 cerradas más recientes.
- Primera capa de cuota: compacta automáticamente el OHLC bruto de operaciones **cerradas** y conserva `rPath`, MFE/MAE, niveles R y comparaciones de salida. Si aun así no cabe, entra la segunda capa descrita arriba.
- Cambia `Resultado acumulado` por métricas separadas: P&L simulado, retorno sobre capital base, resultado en R y movimiento acumulado (marcado como no-rentabilidad).
- Muestra riesgo abierto agregado y alerta de exposición cuando supera 10% del capital base.
- Muestra riesgo LONG/SHORT abierto por separado.
- Cuenta velas ambiguas donde stop y target fueron tocados en la misma vela; se mantiene el criterio conservador de stop primero.
- Los respaldos nuevos se identifican como v6.9.5 y la restauración de respaldos grandes aplica la compactación segura si hace falta.

## Importante
Antes de actualizar, conserva el respaldo JSON original. La compactación nunca borra operaciones, resultados, MFE/MAE, niveles R, QRA ni comparaciones de salida. Sólo en la segunda capa puede resumir `rPath` antiguo; por eso el respaldo previo sigue siendo el archivo histórico completo.

## Laboratorio Aronson-QRA añadido antes del despliegue
- QRA-03 virtual: no modifica las operaciones control. Registra un tamaño hipotético según concentración de riesgo de la misma dirección: <10% = 1.00x, 10-<20% = 0.50x, 20-<30% = 0.25x y >=30% = 0x. Esta regla queda sellada como `QRA03-VIRTUAL-1` para evaluación prospectiva.
- Benchmark BTC virtual: guarda una referencia BTC causal (último cierre disponible del mismo timeframe antes de la entrada) y, al cerrar la operación, calcula retorno direccional BTC, R de benchmark y exceso de R de Centro Quant. No interviene en entradas ni salidas.
- Sello formal de hipótesis: las nuevas operaciones guardan `ARONSON-HYPOTHESES-2026-08-22-1` y la lista de hipótesis congeladas para distinguir descubrimiento de validación prospectiva.
- El CSV incluye multiplicador QRA-03, riesgo virtual, benchmark BTC, exceso R y versión de hipótesis.


## v6.9.7 · Sensibilidad trailing Aronson
- El backtest de mercado calcula en una sola corrida trailing 0.20R, 0.25R, 0.30R, 0.40R y 0.50R sobre las mismas entradas.
- Reporta total R, expectancy, drawdown, cobertura, LONG/SHORT y régimen BTC para cada paso.
- Es sólo laboratorio retrospectivo; no modifica paper trading, señales, score, stop, target, pesos ni la cohorte prospectiva.
- La meta es evaluar robustez/meseta, no escoger retrospectivamente el mejor parámetro.

## v6.9.9 · Universo histórico point-in-time
- El laboratorio puede importar un JSON de rankings históricos y velas para filtrar cada señal por el Top N que existía en esa fecha.
- No modifica el paper trading ni la cohorte prospectiva.
- Incluye `build_point_in_time_dataset.py`: usa el endpoint oficial `listings/historical` de CoinMarketCap mediante `CMC_API_KEY` y Binance Vision para velas 1D archivadas.
- El resultado exportado marca si se usó universo actual o histórico y cuántos snapshots contenía el dataset.
