# Centro Quant v6.3 · Semáforo inteligente

Versión estable con motor de score explicable, simulador, diario y semáforo de decisión.

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
