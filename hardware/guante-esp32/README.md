# Guante con sensor (ESP32-S3 Super Mini + MPU6050)

Firmware del guante que controla el juego inclinando la mano.
El ESP32-S3 se conecta por USB y la PC lo reconoce como **teclado + mouse**,
así que funciona sin instalar nada. Además envía las lecturas del sensor por el
puerto serie para que el juego las muestre y pueda cambiar los ajustes del guante.

## Conexiones

| MPU6050 | ESP32-S3 Super Mini |
|---------|---------------------|
| VCC     | 3V3 (no 5V)         |
| GND     | GND                 |
| SDA     | GPIO 8              |
| SCL     | GPIO 9              |
| AD0     | GND o sin conectar  |

XDA, XCL e INT quedan sin conectar.

## Subir el firmware

Abrir esta carpeta con PlatformIO (VS Code) y pulsar **Upload**.
Si la subida falla: mantener **BOOT**, pulsar **RST**, soltar **BOOT** y volver a subir.

Antes de subir, cerrar el juego (o pulsar "Desconectar" en Configuración → Guante),
porque el juego ocupa el puerto USB.

## Uso

- Al conectar el guante, mantenerlo quieto 1 segundo: esa posición queda como centro.
- **Modo flechas** (niveles 1, 2, 4): inclinar la mano presiona ← → ↑ ↓.
  Con poca inclinación la nave va lenta, con mucha va rápida.
- **Modo mouse** (nivel 3, nivel 5 y menús): inclinar mueve el cursor;
  mantener **BOOT** = clic (sirve para arrastrar).
- **Doble pulsación de BOOT**: cambia entre modo flechas y modo mouse.

## Configuración

- **Desde el juego** (Chrome, Edge o la app de escritorio): Configuración → 🧤 GUANTE.
  Conectar, ver la lectura en vivo, calibrar, elegir modo, velocidad, sensibilidad e invertir ejes.
- **Desde el WiFi del guante**: red `ESP32S3-SuperMini` (clave `12345678`), abrir http://192.168.4.1.

## Teclas en el juego

| Tecla | Acción                                  |
|-------|-----------------------------------------|
| F5    | Mostrar / ocultar el panel del sensor   |
| F6    | Pausar / continuar las lecturas         |
| P     | Pasar el nivel actual (para pruebas)    |

## Órdenes por puerto serie (115200 baudios)

| Orden                    | Respuesta / efecto                          |
|--------------------------|---------------------------------------------|
| `GET`                    | `CFG:{...}` con la configuración actual     |
| `SET clave=valor ...`    | Cambia y guarda ajustes, responde `CFG:{...}` |
| `CAL`                    | Toma la posición actual como centro         |

Claves de `SET`: `mode` (0 desactivado, 1 flechas, 2 mouse), `keySpeed`, `keyAngle`,
`mouseSpeed`, `deadZone`, `invertX`, `invertY`, `printMs`, `readMs`.
