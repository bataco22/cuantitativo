# Centro de Trading Cuantitativo

PWA personal sin servidor ni claves de exchange.

## Probar localmente
No abras `index.html` directamente. Usa un servidor local:

```bash
python3 -m http.server 8000
```

Luego abre `http://localhost:8000`.

## Publicar gratis en GitHub Pages
1. Crea un repositorio nuevo.
2. Sube todos los archivos de esta carpeta conservando la estructura.
3. En Settings > Pages, publica la rama `main` desde `/root`.
4. Abre la dirección que genere GitHub.
5. En iPhone: Safari > Compartir > Agregar a pantalla de inicio.

## Datos
La app consulta datos públicos de mercado de Binance. No pide API key ni puede ejecutar operaciones.

## Primera versión
- Favoritos
- Precios de 24 h
- Score cuantitativo
- Análisis 4H, diario, semanal y mensual
- EMA20, EMA50, EMA200, RSI, ADX, ATR y volumen
- Backtesting de tres reglas predefinidas
- Calculadora de tamaño de posición
- Pesos configurables

## Aviso
Herramienta educativa y de investigación. Los resultados históricos no garantizan rendimientos futuros.

## Versión 3
- Pestaña Pruebas para paper trading
- Long y Short simulados
- Stop y objetivo por precio o porcentaje
- Captura automática del score e indicadores al abrir la prueba
- Revisión automática de objetivo/stop con velas posteriores
- Diario local con estadísticas de acierto y resultado promedio

Si stop y objetivo aparecen tocados dentro de una misma vela, la app registra pérdida de forma conservadora porque no puede conocer el orden intravela.

## Versión 4
- Cada indicador se puede tocar para abrir una explicación.
- Medidor visual con zonas de referencia.
- Estado en lenguaje sencillo: bajo, normal, fuerte, sobrecompra, etc.
- El volumen usa la última vela cerrada para evitar valores artificialmente bajos.
