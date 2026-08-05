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
