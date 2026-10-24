# Guante: hardware y firmware

Archivo único: `hardware/guante-esp32/src/main.cpp`. Configuración: `hardware/guante-esp32/platformio.ini`.

## Índice
1. Hardware y cableado
2. Compilar y subir
3. Estructura del firmware
4. Lectura del sensor
5. Inclinación y calibración
6. Modos de control (HID)
7. Botón BOOT
8. Ajustes guardados (NVS)
9. Página WiFi
10. Cómo hacer cambios típicos

---

## 1. Hardware y cableado

| MPU6050 (GY-521) | ESP32-S3 Super Mini |
|---|---|
| VCC | 3V3 — nunca 5V |
| GND | GND |
| SDA | GPIO 8 |
| SCL | GPIO 9 |
| AD0 | GND o sin conectar → dirección 0x68 (a 3V3 sería 0x69 y el firmware no lo encuentra) |
| XDA, XCL, INT | sin conectar |

Otros pines de la placa: BOOT = GPIO 0 (entrada con pull-up, activo en LOW), LED = GPIO 48
(se fuerza apagado en `setup()` porque el usuario lo pidió). La placa trae además un LED de
carga que parpadea sin batería; ese no se controla por software.

El sensor del usuario va montado **boca abajo** (Z ≈ −1 g en reposo). El firmware lo tolera
porque normaliza los ángulos a ±180° y calibra el centro al arrancar; si las direcciones
quedan invertidas se corrige con `invertX` / `invertY`, no tocando fórmulas.

## 2. Compilar y subir

```bash
cd hardware/guante-esp32
pio run              # solo compilar
pio run -t upload    # compilar y subir
```

Si `pio` no está en el PATH (Windows): `~/.platformio/penv/Scripts/pio.exe`.

Claves de `platformio.ini`:

```ini
board = esp32-s3-devkitc-1          ; el Super Mini es compatible
board_upload.flash_size = 4MB
build_flags =
    -DARDUINO_USB_MODE=0             ; TinyUSB: permite teclado + mouse + serie a la vez
    -DARDUINO_USB_CDC_ON_BOOT=1      ; Serial = USB
board_upload.use_1200bps_touch = yes ; reinicia a modo carga abriendo el puerto a 1200 baudios
board_upload.wait_for_upload_port = yes ; el COM cambia al entrar en modo carga
```

Problemas al subir:
- **"Could not open COMx, the port is busy"** → el juego (u otro monitor serie) tiene el puerto. Cerrarlo.
- **"No serial data received"** → modo carga manual: mantener BOOT, pulsar RST, soltar BOOT, subir.
- Tras subir, el número de COM puede cambiar. Para encontrarlo:
  ```python
  import serial.tools.list_ports as l
  print([p.device for p in l.comports() if '303A' in p.hwid])
  ```

## 3. Estructura del firmware

`loop()` hace, sin bloquear:

1. `server.handleClient()` — página WiFi
2. `updateButton()` — botón BOOT
3. `readSerialCommands()` — órdenes `GET` / `SET` / `CAL`
4. cada `cfg.readMs` → `mpuRead()` → `updateAngles(dt)` → calibración inicial → `updateHid(dt)`
5. cada `cfg.printMs` (si > 0) → imprime la línea de lectura

No uses `delay()` en `loop()`: frena la lectura, el HID y la página web a la vez.

## 4. Lectura del sensor

Sin librerías: registros por I2C a 400 kHz.

| Registro | Uso |
|---|---|
| 0x6B PWR_MGMT_1 | escribir 0 para despertar |
| 0x1A CONFIG | filtro pasa bajos: `cfg.filter` 0..6 = 260/184/94/44/21/10/5 Hz |
| 0x1B GYRO_CONFIG | `cfg.gyroRange << 3` (±250/500/1000/2000 °/s) |
| 0x1C ACCEL_CONFIG | `cfg.accelRange << 3` (±2/4/8/16 g) |
| 0x3B.. | 14 bytes big-endian: ax, ay, az, temp, gx, gy, gz |

Escalas: `g = raw / (16384 >> rango)`, `°/s = raw / (131 / 2^rango)`, `°C = raw/340 + 36.53`.
Si `mpuRead()` falla, `mpuOk = false`, se sueltan las teclas y se reintenta `mpuInit()` cada 2 s.
Los módulos clon responden bien a esta secuencia aunque su WHO_AM_I no sea 0x68; por eso no se valida WHO_AM_I.

## 5. Inclinación y calibración

```
accRoll  = atan2(ay, az)
accPitch = atan2(-ax, sqrt(ay² + az²))
pred     = ángulo + giro * dt
ángulo   = wrap180(pred + 0.04 * wrap180(acc - pred))   // filtro complementario 0.96 / 0.04
roll     = wrap180(rawRoll  - cfg.offRoll)
pitch    = wrap180(rawPitch - cfg.offPitch)
```

`wrap180` es imprescindible: sin él, un sensor boca abajo (≈ ±180°) salta de +179 a −179 y la
nave gira sola.

**Calibración:** al arrancar se espera 1 s de lecturas válidas y se llama `calibrate()`
(guarda `rawRoll/rawPitch` como offset). Hasta entonces `calibrated = false` y `updateHid()`
no envía nada — así el guante no "presiona" teclas al enchufarlo. Los offsets **no se
persisten** a propósito: el centro es la posición al conectar. `CAL` (serie) y `/calibrate`
(web) recalibran en caliente.

## 6. Modos de control (HID)

`cfg.mode`: 0 = Desactivado, 1 = Flechas, 2 = Mouse. Ejes: `x = roll` (izq −, der +),
`y = pitch` (adelante −, atrás +), invertidos según `invertX/invertY`.

**Flechas (`setKey`)** — presión a pulsos para que la velocidad sea proporcional:
- Activa cuando `valor > keyAngle`, se desactiva cuando `valor < keyAngle * 0.7` (histéresis).
- `strength = clamp(0.3 + 0.7 * (valor - keyAngle) / 30, 0.3, 1)`
- `duty = strength * keySpeed / 100`; dentro de cada ciclo de `PULSE_MS = 80` ms la tecla está
  presionada la fracción `duty` del tiempo (siempre presionada si `duty ≥ 0.99`).
- `keyDown[]` = estado real enviado; `keyActive[]` = superó el umbral.

Esto existe porque con teclas todo-o-nada la nave del nivel 1 giraba demasiado rápido con el guante.

**Mouse** — velocidad (px/s) = `(|ángulo| - deadZone) * mouseSpeed * 2`, acumulando fracciones
en `mouseAccX/Y` y enviando `Mouse.move()` limitado a ±127 por llamada.

`releaseAll()` suelta flechas y botón del mouse y limpia acumuladores. Llamarlo en todo cambio
de modo (`setMode` ya lo hace) y al perder el sensor.

## 7. Botón BOOT (`updateButton`)

- Antirrebote 25 ms.
- En modo Mouse: presionar = `Mouse.press(MOUSE_LEFT)`, soltar = release (permite arrastrar,
  necesario en el nivel 3).
- Doble pulsación (< 350 ms entre pulsaciones): alterna Flechas ↔ Mouse con `setMode`.

## 8. Ajustes guardados (NVS)

```cpp
struct Settings {
  uint8_t accelRange, gyroRange, filter;
  uint16_t readMs, printMs;
  uint8_t mode, keyAngle, mouseSpeed, deadZone;
  bool invertX, invertY;
  float offRoll, offPitch;
  uint8_t keySpeed;
};
Settings cfg = {0, 0, 3, 10, 100, MODE_KEYS, 15, 10, 4, false, false, 0, 0, 50};
```

Se guarda como un blob: `Preferences` espacio `"ctrl"`, clave `"cfg"`. `loadSettings()` solo lo
usa si `getBytesLength("cfg") == sizeof(Settings)`; si cambió el tamaño, quedan los valores por
defecto (comportamiento intencional para no leer basura).

| Clave | Rango | Defecto |
|---|---|---|
| mode | 0..2 | 1 |
| keyAngle | 3..60 ° | 15 |
| keySpeed | 10..100 % | 50 |
| mouseSpeed | 1..30 | 10 |
| deadZone | 0..30 ° | 4 |
| invertX / invertY | 0/1 | 0 |
| readMs | 5..5000 | 10 |
| printMs | 0..60000 (0 = no imprimir) | 100 |
| accel / gyro / filter | 0..3 / 0..3 / 0..6 | 0 / 0 / 3 (solo desde la web) |

## 9. Página WiFi

AP `ESP32S3-SuperMini` / `12345678`, IP 192.168.4.1, potencia `WIFI_POWER_8_5dBm` (la antena
cerámica del Super Mini falla a potencia máxima). HTML embebido en `PAGE[] PROGMEM`.

| Ruta | Método | Función |
|---|---|---|
| `/` | GET | `handleRoot` — página |
| `/data` | GET | `{"ok","roll","pitch","mode","modeName"}` |
| `/config` | GET | `handleGetConfig` → `configJson()` |
| `/config` | POST | `handleSetConfig` — valida rangos, responde 400 si algo está fuera |
| `/calibrate` | POST | `handleCalibrate` |

La página llena el formulario con `/config` usando los atributos `name` de cada campo, así que
un campo nuevo solo necesita `name="clave"` igual a la clave del JSON.

## 10. Cómo hacer cambios típicos

**Agregar un ajuste nuevo (ej. `vibra`)**
1. `struct Settings`: agregar el campo **al final**; agregar su defecto al final de `cfg = {...}`.
2. `configJson()`: agregar `"vibra":%u` al formato y el argumento.
3. `applySerialSetting()`: `else if (key == "vibra") cfg.vibra = constrain(v, min, max);`
4. (Opcional) web: campo en `PAGE`, lectura y validación en `handleSetConfig()`.
5. Juego: ver `vistas-configuracion.md` → "Agregar un ajuste del guante".
6. Avisar al usuario que, al subir este firmware, los ajustes vuelven a valores por defecto.

**Cambiar el formato de la línea de lectura** → actualizar `LINE_RE` en `src/sensor/SensorHud.ts`
en el mismo cambio, y la sección del protocolo en `DOCUMENTACION.md`.

**Agregar una orden serie nueva** → nueva rama en `handleSerialCommand()`. Responder siempre con
una línea (p. ej. `printConfigLine()` u `OK:...`) para que el juego pueda confirmar.

**Cambiar pines I2C** → `I2C_SDA` / `I2C_SCL` y actualizar las tablas de cableado en
`hardware/guante-esp32/README.md` y `DOCUMENTACION.md`.
