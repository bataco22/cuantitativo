# Centro Quant v6.9.4

Corrección de auditoría y almacenamiento sobre v6.9.2/v6.9.3.

## Cambios
- Corrige el error `The quota has been exceeded` compactando automáticamente el OHLC bruto de operaciones **cerradas** cuando localStorage llega a su límite. Se conserva `rPath`, MFE/MAE, niveles R y comparaciones de salida para el laboratorio.
- Cambia `Resultado acumulado` por métricas separadas: P&L simulado, retorno sobre capital base, resultado en R y movimiento acumulado (marcado como no-rentabilidad).
- Muestra riesgo abierto agregado y alerta de exposición cuando supera 10% del capital base.
- Muestra riesgo LONG/SHORT abierto por separado.
- Cuenta velas ambiguas donde stop y target fueron tocados en la misma vela; se mantiene el criterio conservador de stop primero.
- Los respaldos nuevos se identifican como v6.9.4 y la restauración de respaldos grandes aplica la compactación segura si hace falta.

## Importante
Antes de actualizar, conserva el respaldo JSON original. La compactación sólo elimina OHLC bruto redundante de operaciones ya cerradas cuando falta espacio; no borra operaciones ni su `rPath`.
