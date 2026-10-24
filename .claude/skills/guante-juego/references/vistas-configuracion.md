# Vistas (escenas), controles y configuración del juego

## Índice
1. Mapa de escenas
2. Convenciones de una escena
3. Controles de la nave (`controlType`)
4. Atajos de teclado
5. Configuración: `ConfigScene`
6. Configuración → Guante: `GloveConfigScene`
7. Ajustes guardados del juego
8. Recetas: agregar un ajuste, una vista, un nivel
9. Verificación

---

## 1. Mapa de escenas

Registradas en `src/main.ts` (el orden importa solo para la primera: `BootScene`).

| Escena | Archivo | Rol |
|---|---|---|
| BootScene | `scenes/BootScene.ts` | Fija `isMobile = true`, `controlType = 'pointer'` y pasa a Preload |
| PreloadScene | `scenes/PreloadScene.ts` | Carga imágenes de `public/assets` y genera texturas por código |
| MainMenuScene | `scenes/MainMenuScene.ts` | Menú; "Comenzar" va a `StorageService.getTargetScene()` |
| GameScene | `scenes/GameScene.ts` | Nivel 1: gravedad radial (`gravityStrength = 18000` × atracción%), 3 sondas, 3 vidas |
| Level2Scene | `scenes/Level2Scene.ts` | Nivel 2: sobrevivir 15 s, asteroides, gravedad de estrella (10000) |
| Level3Scene | `scenes/Level3Scene.ts` | Nivel 3: arrastrar entre estrellas (requiere mouse/toque), 45 s |
| Level4Scene | `scenes/Level4Scene.ts` | Nivel 4: runner horizontal, 10 s |
| Level5Scene | `scenes/Level5Scene.ts` | Nivel 5: clic en estaciones para girarlas 45° y alinear haces |
| EncyclopediaScene, BadgesScene, CreditsScene | `scenes/...` | Pantallas informativas |
| ConfigScene | `scenes/ConfigScene.ts` | Sonido, reiniciar progreso, botón 🧤 GUANTE |
| GloveConfigScene | `scenes/GloveConfigScene.ts` | Configuración del guante y atracción del nivel 1 |

Lienzo: 1280 × 576 (`Phaser.Scale.FIT`). Usa `this.cameras.main.width/height` en vez de números fijos.

## 2. Convenciones de una escena

- Transición estándar entre pantallas:
  ```ts
  AudioService.playSFX('click');
  this.cameras.main.fadeOut(300, 10, 5, 27);
  this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
    this.scene.start('OtraEscena');
  });
  ```
- Botones Phaser: `graphics.fillRoundedRect` + `add.text(...).setOrigin(0.5)` + `add.zone(...).setInteractive({ useHandCursor: true })` con `on('pointerdown')`.
- Estética: fondo `0x0a051b` con estrellas aleatorias, panel `0x1a1235` con borde `0x673ab7`, títulos `#ffc107`, fuente `"Outfit", "Inter", sans-serif`.
- En los niveles, `quizActive = true` mientras hay pregunta: detiene física y temporizadores. Todo atajo o input debe respetarlo (`if (!this.quizActive) ...`).
- Cada nivel termina en `completeLevel()`: llama `StorageService.setCurrentLevel(n+1)` y `unlockBadge(id)`, y muestra el panel de "nivel completado".

**Vistas con HTML (formularios).** Para pantallas con muchos controles (sliders, checkboxes) es
más simple un `div` DOM encima del lienzo, como hace `GloveConfigScene`:
1. Crear el `<style>` y el `div` en `create()`.
2. `root.addEventListener('pointerdown', e => e.stopPropagation())` para que los clics no lleguen a Phaser.
3. Limpiar en `this.events.once(Phaser.Scenes.Events.SHUTDOWN, ...)`: quitar el `div`, el `<style>` y desuscribir `SensorService.onChange`.
   Si no se limpia, el formulario queda flotando sobre la escena siguiente.

## 3. Controles de la nave (`controlType`)

`BootScene` fija `this.registry.set('controlType', 'pointer')`. En niveles 1, 2 y 4 el
`update()` hace:

```ts
const controlType = this.registry.get('controlType') || 'keyboard';
// Con toque/mouse presionado se sigue el dedo; si no, flechas (teclado o guante)
if (controlType === 'pointer' && this.input.activePointer.isDown) {
  // seguir al puntero
} else {
  // flechas: this.cursors.left/right/up/down + botones virtuales isLeftDown...
}
```

Es **híbrido a propósito**: en la rama `apk` original, `pointer` ignoraba las flechas y el guante
(que envía flechas) no movía la nave. No vuelvas a separar las ramas `if/else` por `controlType`
sin mantener las flechas activas cuando no se toca.

Velocidades actuales: nivel 1 gira 200 °/s y avanza 200; nivel 2 gira 250 y avanza 250; nivel 4
acelera 1000 en X. El guante en modo Flechas presiona a pulsos (`keySpeed`), por eso no hace falta
cambiar estas velocidades para "suavizar" el guante; ajusta `keySpeed`/`keyAngle`.

Niveles 3 y 5 se juegan con el puntero → el guante debe estar en modo Mouse (BOOT = clic).

**Leer el guante directamente (control proporcional)** — si se quiere en un nivel:
```ts
import { SensorService } from '../sensor/SensorHud';
const r = SensorService.latest;              // null si no hay conexión serie
if (r) this.probe.setAngularVelocity(Phaser.Math.Clamp(r.roll / 45, -1, 1) * 200);
```
Entonces poner el guante en `mode: 0` para que no envíe flechas a la vez, y bajar `printMs`
(p. ej. 20) para más fluidez. Mantener el camino por flechas como respaldo cuando `r` es null.

## 4. Atajos de teclado

| Tecla | Dónde | Implementación |
|---|---|---|
| P | Todos los niveles | `this.input.keyboard.addKey('P').on('down', ...)` → `if (!this.quizActive) { this.quizActive = true; this.completeLevel(); }` (nivel 1 y 4 sin poner `quizActive`, porque su `completeLevel` ya lo hace o no lo necesita) |
| F5 | Global | `SensorHud` (mostrar/ocultar panel) |
| F6 | Global | `SensorHud` (pausar panel) |

Antes de asignar una tecla nueva, busca usos (`grep -rn "addKey\|keydown" src`). F5/F6 los
captura `window` en fase de captura, así que no los uses en escenas.

## 5. Configuración: `ConfigScene`

Panel de 500 × 500 centrado. Elementos y posiciones (relativas a `width/2`, `height/2`):
silenciar (−90), música (−20…+27), efectos (+60…+107), fila de botones en +130…+170:
**REINICIAR PROGRESO** a la izquierda (centro −122, ancho 225) y **🧤 GUANTE** a la derecha
(centro +122, ancho 225), **VOLVER** en +190…+240. No queda espacio vertical: para opciones
nuevas, agrégalas en `GloveConfigScene` o crea otra escena y un botón que lleve a ella.

## 6. Configuración → Guante: `GloveConfigScene`

Formulario DOM `#glove-config` con:
- Estado + botón **Conectar/Desconectar** (`SensorService.connect()/disconnect()`).
- Lectura en vivo (`.sensor-level`, `placeBall`) y **Calibrar centro** (`SensorService.calibrate()`).
- Botones de modo `data-mode="1|2|0"` → `setConfig({ mode })`.
- Sliders y checkboxes con `data-cfg="<clave>"`: el valor se muestra en `[data-val="<clave>"]`
  durante `input` y se envía con `setConfig` en `change` (al soltar), para no saturar el puerto.
- Sección "Juego": atracción del nivel 1 (`GameSettings`), guardada en el navegador.

`refresh()` se llama en cada `onChange`: actualiza estado y lectura, deshabilita la sección del
guante (`.disabled`) hasta que llega `SensorService.config`, y no pisa el control que el usuario
tiene enfocado (`document.activeElement`).

## 7. Ajustes guardados del juego

| Dónde | Clave localStorage | Qué |
|---|---|---|
| `utils/StorageService.ts` | `el_misterio_del_agujero_negro_progress` | nivel actual, desbloqueados, insignias, volumen |
| `utils/GameSettings.ts` | `el_misterio_del_agujero_negro_settings` | `gravityPercent` (10–150, defecto 50) |
| Firmware (NVS) | — | ajustes del guante (ver `guante-firmware.md`) |

Regla: progreso del jugador → `StorageService`; preferencias de juego → `GameSettings`; lo que
afecta cómo se comporta el guante → firmware (vía `setConfig`). "Reiniciar progreso" solo borra
`StorageService`.

## 8. Recetas

### Agregar un ajuste del guante (ej. `vibra`)
1. Firmware: seguir `guante-firmware.md` → "Agregar un ajuste nuevo".
2. `SensorHud.ts`: agregar `vibra: number;` a `interface GloveConfig`.
3. `GloveConfigScene.ts`, dentro de `[data-k="gloveOpts"]`:
   ```html
   <div class="row"><span>Vibración</span>
     <input type="range" min="0" max="100" step="5" data-cfg="vibra"><span class="val" data-val="vibra">–</span></div>
   ```
   No hace falta más código: los listeners y `refresh()` recorren `input[data-cfg]`.
4. Documentar la clave en `DOCUMENTACION.md` (tabla de ajustes) y en `hardware/guante-esp32/README.md`.

### Agregar un ajuste de juego (ej. velocidad de asteroides)
1. `GameSettings.ts`: campo en `Settings` + `DEFAULTS` + getter/setter con límites.
2. `GloveConfigScene.ts`: slider en la sección "Juego" (patrón de `gravity`: `data-k`, guarda en `input`).
3. Usarlo en la escena con `GameSettings.getX()` dentro de `update()` o al crear.

### Agregar una vista nueva
1. Crear `scenes/MiVistaScene.ts` (`super('MiVistaScene')`), con fondo y botón VOLVER según §2.
2. Registrarla en el array `scene` de `main.ts` e importarla.
3. Enlazarla desde un botón de otra escena con la transición estándar.

### Agregar un nivel
1. Copiar la estructura de un nivel parecido (`create`, `update`, panel de preguntas, `completeLevel`).
2. Registrar en `main.ts`; en el `completeLevel()` anterior, ir a la nueva escena.
3. `StorageService.setCurrentLevel()` y `getTargetScene()` para el nuevo número.
4. Insignia en `BadgesScene.ts` + `unlockBadge('id')`.
5. Atajo P y, si se mueve con flechas, la lógica híbrida de §3.

## 9. Verificación

```bash
npx tsc --noEmit   # debe salir sin errores (noUnusedLocals: un import sin usar falla)
npm run build      # tsc + vite build
npm run dev        # http://localhost:5173 (Vite recarga solo al guardar)
```

Con el guante: abrir Configuración → 🧤 GUANTE, comprobar punto verde, lectura moviéndose y que
un cambio de slider se refleja (la placa responde `CFG:` y el valor se mantiene al volver a entrar).
