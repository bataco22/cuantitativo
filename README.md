# Centro Quant v6.9.6

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
