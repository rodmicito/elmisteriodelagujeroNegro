---
name: guante-juego
description: Guía para trabajar con el guante con sensor (ESP32-S3 Super Mini + MPU6050) y el juego "El Misterio del Agujero Negro" (Phaser 3 + TypeScript). Explica cómo cablear y programar el guante, cómo se conecta el juego al guante por USB (teclado/mouse HID y Web Serial con órdenes GET/SET/CAL), y cómo modificar escenas, pantallas, el panel del sensor y la configuración (Configuración → Guante, página WiFi del guante, ajustes guardados). Úsala siempre que la tarea toque el guante, el firmware en hardware/guante-esp32, SensorHud/SensorService, GloveConfigScene, ConfigScene, los controles de la nave, la tecla P/F5/F6, la atracción del nivel 1, o cuando alguien pregunte cómo conectar, calibrar, configurar o depurar el guante o el juego, aunque no diga "skill" ni "guante" explícitamente (p. ej. "la nave no se mueve con el sensor", "agrega un ajuste nuevo", "cambia la pantalla de configuración", "no sube el firmware").
---

# Guante + juego: cómo funciona y cómo modificarlo

Este proyecto tiene dos partes que se comunican por **un solo cable USB-C**:

```
MPU6050 --I2C--> ESP32-S3 --USB--> PC
                    |               ├─ Teclado + mouse HID  → el juego recibe flechas / cursor
                    |               └─ Puerto serie 115200  → lecturas + órdenes GET/SET/CAL
                    └─ WiFi AP "ESP32S3-SuperMini" → página de ajustes en 192.168.4.1
```

- **Firmware:** `hardware/guante-esp32/` (PlatformIO, Arduino core ESP32 2.0.17, un solo `src/main.cpp`).
- **Juego:** `src/` (Phaser 3.90, TypeScript estricto, Vite). Conexión con el guante en `src/sensor/SensorHud.ts`.
- **Documentación humana completa:** `DOCUMENTACION.md` en la raíz.

La idea clave del diseño: **el guante funciona sin código especial en el juego** porque se presenta como teclado y mouse. El puerto serie es un extra para *ver* las lecturas y *cambiar* ajustes desde el juego. Si rompes el puerto serie, el guante sigue moviendo la nave; si rompes el HID, la nave deja de moverse aunque el panel muestre datos. Ten esto en cuenta al diagnosticar.

## Qué archivo de referencia leer

Lee solo el que corresponda a la tarea:

| Tarea | Lee |
|---|---|
| Cablear, subir firmware, cambiar comportamiento del guante (sensor, filtro, flechas, mouse, botón BOOT, WiFi, ajustes en flash) | `references/guante-firmware.md` |
| Conexión juego ↔ guante: protocolo serie, `SensorService`, panel F5/F6, Electron, depurar conexión | `references/conexion-juego.md` |
| Modificar pantallas/escenas, controles de los niveles, Configuración, `GloveConfigScene`, ajustes guardados del juego, agregar niveles o ajustes | `references/vistas-configuracion.md` |

## Reglas que evitan los errores más comunes

1. **Firmware y juego comparten contrato.** El juego parsea la línea de lectura con una expresión regular (`LINE_RE` en `SensorHud.ts`) y la respuesta `CFG:{json}`. Si cambias el `printf` de la lectura o los nombres de las claves en el firmware, actualiza el juego en el mismo cambio. Lo mismo al revés.
2. **Agregar un ajuste del guante toca 3 lugares del firmware** (`struct Settings` al final + valor por defecto en `cfg`, `configJson()`, `applySerialSetting()`) y 2 del juego (`GloveConfig` y un control `data-cfg` en `GloveConfigScene`). Cambiar el tamaño de `Settings` hace que la placa vuelva a valores por defecto al arrancar (se detecta por tamaño) — es esperado, avísalo al usuario.
3. **Para subir firmware, el puerto debe estar libre.** Si el juego está abierto y conectado, `pio run -t upload` falla con "port is busy". Pide cerrar la pestaña del juego (o "Desconectar" en Configuración → Guante). Tras subir, el COM cambia (p. ej. COM8 en modo carga → COM9 en ejecución); `platformio.ini` ya trae `use_1200bps_touch` y `wait_for_upload_port` para manejarlo.
4. **El guante presiona teclas de verdad en la PC.** Si vas a probar algo con el guante conectado en modo Flechas o Mouse, puede escribir o mover el cursor en otros programas. Para trabajar tranquilo, pon el modo en Desactivado (`SET mode=0`).
5. **Verifica antes de dar por hecho.** Juego: `npx tsc --noEmit` (el tsconfig tiene `noUnusedLocals`/`noUnusedParameters`, un import sin usar rompe el build) y `npm run build`. Firmware: `pio run` y, con la placa conectada, envía `GET` por serie y comprueba que responde `CFG:{...}` (ver `references/conexion-juego.md`, "Probar desde la PC").
6. **No dejes teclas pegadas.** Cualquier camino del firmware que cambie de modo, pierda el sensor o desactive el control debe llamar `releaseAll()`.
7. **Preferencias del usuario ya decididas:** el LED de la placa (GPIO 48) se mantiene apagado; la tecla **P** pasa de nivel; **F5** muestra/oculta el panel del sensor (Ctrl+F5 recarga); **F6** pausa el panel; la configuración del guante vive en **Configuración → 🧤 GUANTE**, no superpuesta durante el juego.

## Datos rápidos

| Dato | Valor |
|---|---|
| Pines MPU6050 | VCC→3V3, GND→GND, SDA→GPIO 8, SCL→GPIO 9, AD0→GND o libre (0x68) |
| Botón | BOOT = GPIO 0 (clic en modo mouse; doble pulsación cambia Flechas↔Mouse) |
| USB | TinyUSB compuesto "Control MPU6050", VID 0x303A, serie a 115200 |
| WiFi | SSID `ESP32S3-SuperMini`, clave `12345678`, http://192.168.4.1 |
| Lienzo del juego | 1280 × 576, `Phaser.Scale.FIT` |
| Navegadores con Web Serial | Chrome, Edge, Electron (no Firefox, no Android) |
| Comandos | `npm run dev` (juego) · `pio run -t upload` en `hardware/guante-esp32` (firmware) |
