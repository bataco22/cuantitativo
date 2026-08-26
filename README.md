# Centro Quant v6.11.7 · QRA-06 Timing/Contexto OOS

Base operativa congelada: v6.11.6 Entrada Sincronizada.

## Qué añade QRA-06
- Capa estrictamente `research-only` y fuera de muestra.
- Observa cada operación DESPUÉS de que el control ya fue creado.
- Reconstruye 15m, 1h, 4h y 1d usando `endTime = createdAt - 1` para evitar información futura.
- Registra contexto, score/opuesto, tendencia, EMA20/50/55/200, RSI, ADX, ATR, volumen, posición en rango 20, ruptura de estructura y fase QRA-05.
- Produce una decisión VIRTUAL: `TIMING_CANDIDATO`, `ESPERAR_PULLBACK`, `RIESGO_ENTRADA_TARDIA`, `CONTRA_CONTEXTO` u `OBSERVAR`.

## Lo que NO cambia
- Score y pesos.
- Umbral de entrada.
- `scanAutoPaper()`.
- Frescura/sincronización de señal v6.11.6.
- `activateCausalTrade()`.
- Entrada causal al siguiente minuto.
- Stop, target, RR 1:3.
- Seguimiento, MFE/MAE, trailing/escalera o cierres.

QRA-06 solo escribe metadatos observacionales en `qra06Context` dentro del JSON para comparar después con el resultado real.
