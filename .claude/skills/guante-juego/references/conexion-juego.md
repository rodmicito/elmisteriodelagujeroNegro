# Conexión juego ↔ guante

Código: `src/sensor/SensorHud.ts` (exporta `SensorService`, `SensorHud`, `placeBall` y los tipos
`SensorReading`, `GloveConfig`). Se inicializa en `src/main.ts` después de `new Phaser.Game(config)`:

```ts
SensorHud.init();      // panel F5 / F6
SensorService.init();  // conexión con el guante
```

## 1. Dos canales por el mismo USB

| Canal | Qué lleva | Requiere |
|---|---|---|
| HID teclado/mouse | Flechas o movimiento del cursor según la inclinación | Nada: lo ve cualquier programa |
| Puerto serie (CDC, 115200) | Lecturas del sensor + órdenes de configuración | Web Serial (Chrome, Edge, Electron) y permiso del usuario una vez |

Diagnóstico rápido: si la nave se mueve pero el panel dice "Sin conectar", el HID funciona y
solo falta autorizar el puerto serie (Configuración → 🧤 GUANTE → Conectar).

## 2. Protocolo serie (texto, una línea por mensaje, `\n`)

**Guante → juego**

Lectura, cada `printMs` ms:
```
Incl X:  12.3 Y:  -4.0 | Acel(g) X: 0.10 Y:-0.20 Z: 0.98 | Giro X:   1.0 Y:   0.5 Z:  -0.2 | Flechas
```
La última palabra es el modo: `Flechas`, `Mouse` o `Desactivado`.

Se parsea con:
```ts
const LINE_RE =
  /Incl X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) \| Acel\(g\) X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) Z:\s*(-?[\d.]+) \| Giro X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) Z:\s*(-?[\d.]+) \| (\S+)/;
```

Sensor ausente (cada 2 s): `MPU6050 no detectado: revisa las conexiones`.

Respuesta a órdenes:
```
CFG:{"accel":0,"gyro":0,"filter":3,"readMs":10,"printMs":100,"mode":1,"keyAngle":15,"mouseSpeed":10,"deadZone":4,"invertX":0,"invertY":0,"keySpeed":50}
```

Al arrancar el firmware también imprime líneas informativas ("AP iniciado", "Calibrado…",
"Modo: …"); el juego las ignora porque no coinciden con `LINE_RE` ni empiezan con `CFG:`.

**Juego → guante**

| Orden | Efecto |
|---|---|
| `GET` | responde `CFG:{...}` |
| `SET k=v k=v ...` | aplica (con `constrain` a su rango), guarda en flash, responde `CFG:{...}` |
| `CAL` | calibra el centro, responde `CFG:{...}` |

Valores enteros; claves válidas: `mode keyAngle keySpeed mouseSpeed deadZone invertX invertY printMs readMs`.
Claves desconocidas se ignoran sin error.

## 3. `SensorService`

Estado público: `latest: SensorReading | null`, `config: GloveConfig | null`, `statusText`,
`state: 'on' | 'off' | 'warn'`, `supported`, `connected`.

| Método | Qué hace |
|---|---|
| `init()` | Reintenta conexión automática cada 2 s con puertos ya autorizados (`getPorts()`), escucha `connect`, avisa "sin datos" si pasan 2 s sin lecturas, libera el puerto en `beforeunload` |
| `connect()` | `requestPort({ filters: [{ usbVendorId: 0x303a }] })` — **necesita un clic del usuario** (gesto). Llamar solo desde un handler de click |
| `disconnect()` | Cierra y marca `userClosed` para no reconectar solo |
| `send(cmd)` | Escribe `cmd + '\n'` |
| `setConfig({...})` | Envía `SET` con los pares (redondea a entero) |
| `calibrate()` | Envía `CAL` |
| `onChange(cb)` | Suscribe a cambios (lectura, estado, config). **Devuelve la función para desuscribirse** — úsala al cerrar escenas |

Detalles que importan:
- Al abrir el puerto espera 300 ms y envía `GET`; si llegan lecturas sin `config`, vuelve a pedir `GET`.
- `beforeunload` cierra el puerto: sin esto, al recargar (Vite recarga en cada cambio) la página
  nueva encuentra el puerto ocupado por la vieja.
- Si `open()` falla con `InvalidStateError`, cierra y reintenta en el siguiente ciclo.
- Al abrir a 115200 el firmware **no** se reinicia. No abrir nunca a 1200 baudios: eso reinicia
  la placa en modo de carga.

## 4. `SensorHud` (panel F5 / F6)

Panel DOM fijo abajo a la izquierda (`#sensor-hud`, `pointer-events: none`), oculto al inicio.
- **F5** (sin Ctrl/Shift): `preventDefault()` + mostrar/ocultar. Ctrl+F5 sigue recargando.
- **F6**: congela/descongela los valores (`paused`), `preventDefault()` evita que el navegador
  enfoque la barra de direcciones.
- El listener de teclado va en fase de captura (`addEventListener(..., true)`) para recibir las
  teclas antes que Phaser.
- No usar **P** aquí: P pasa de nivel en todos los niveles.

Estilos compartidos para reutilizar en otras vistas: `.sensor-dot` (`.on`, `.warn`),
`.sensor-level` + `.sensor-ball` (nivel de burbuja). Mover la bola con `placeBall(el, lectura)`.

## 5. Electron (app de escritorio)

`electron/main.cjs` necesita, porque Electron no muestra el selector de puerto:

```js
ses.on('select-serial-port', (event, portList, _wc, callback) => {
  event.preventDefault();
  const esp = portList.find((p) => (p.vendorId || '').toLowerCase() === '303a');
  callback(esp ? esp.portId : '');
});
ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
```

Si agregas otros permisos a Electron, combínalos en el mismo `setPermissionCheckHandler`
(solo puede haber uno).

## 6. Android

Web Serial no existe en el WebView de Android: `SensorService.supported` es `false` y el panel
muestra "Usa Chrome o Edge…". El juego se controla con el dedo. No intentes conectar el guante
por USB-OTG sin un plugin nativo de Capacitor.

## 7. Probar desde la PC (sin el juego)

Cerrar el juego primero (puerto exclusivo en Windows). Con el Python de PlatformIO:

```python
import serial, time
s = serial.Serial('COM9', 115200, timeout=0.5)
time.sleep(1.5); s.reset_input_buffer()
s.write(b'GET\n')
t = time.time()
while time.time() - t < 2:
    line = s.readline().decode(errors='replace').strip()
    if line: print(line)
s.close()
```

Debe aparecer una línea `CFG:{...}` y lecturas `Incl X: ...`. En Windows:
`~/.platformio/penv/Scripts/python.exe -c "..."`.

## 8. Tabla de diagnóstico

| Síntoma | Causa | Solución |
|---|---|---|
| Panel "Sin conectar: ve a Configuración → Guante" | Sin permiso de Web Serial | Pulsar Conectar (gesto del usuario) |
| "Puerto ocupado, reintentando…" | Monitor serie de PlatformIO, otra pestaña o un script | Cerrar el otro programa |
| "Conectado, pero sin datos" | `printMs = 0` | `SET printMs=100` |
| Panel con datos pero la nave no se mueve | Modo Desactivado/Mouse, o escena que no lee flechas | Revisar modo; ver `vistas-configuracion.md` sobre `controlType` |
| La nave gira sola | Centro mal calibrado | `CAL` con la mano en reposo |
| Ajustes de Configuración → Guante deshabilitados | No llegó `CFG:` (firmware viejo sin órdenes serie) | Subir el firmware actual |
| Upload falla "port is busy" | El juego tiene el puerto | Cerrar el juego o Desconectar |
