# El Misterio del Agujero Negro

Videojuego educativo de astronomía hecho con **Phaser 3 + TypeScript**, con 5 niveles sobre
agujeros negros, estrellas, constelaciones y agujeros de gusano. Se juega con teclado, mouse,
pantalla táctil o con un **guante con sensor de movimiento** (ESP32-S3 + MPU6050).

Funciona en el navegador, como programa de Windows (Electron) y como app de Android (Capacitor).

## Inicio rápido

```bash
npm install
npm run dev
```

Abrir http://localhost:5173 en **Chrome o Edge** (necesarios para conectar el guante).

| Tecla | Acción |
|---|---|
| ← → ↑ ↓ | Mover la nave |
| P | Pasar el nivel actual |
| F5 | Mostrar / ocultar el panel del sensor (Ctrl+F5 recarga la página) |
| F6 | Pausar las lecturas del panel |

## El guante

- Firmware y conexiones: [`hardware/guante-esp32/`](hardware/guante-esp32/README.md)
- En el juego: **Configuración → 🧤 GUANTE** para conectarlo, calibrarlo y ajustarlo.

## Documentación

| Documento | Contenido |
|---|---|
| [DOCUMENTACION.md](DOCUMENTACION.md) | Documentación completa: juego, guante, comunicación, cómo ejecutar, solución de problemas |
| [RESUMEN.md](RESUMEN.md) | Resumen del proyecto |
| [EXPLICACION_CODIGO.md](EXPLICACION_CODIGO.md) | Explicación técnica del código |
| [hardware/guante-esp32/README.md](hardware/guante-esp32/README.md) | Guía rápida del guante |

## Skill para asistentes de IA

El repositorio incluye un **skill** que explica a una IA (Claude Code, Copilot, ChatGPT, etc.)
cómo funciona el guante, cómo se conecta con el juego y cómo modificar las pantallas y la
configuración, junto con los errores comunes que debe evitar.

**Dónde está:** [`.claude/skills/guante-juego/`](.claude/skills/guante-juego/SKILL.md)
(la carpeta `.claude` está oculta en algunos exploradores de archivos)

| Archivo | Para qué tareas |
|---|---|
| [`SKILL.md`](.claude/skills/guante-juego/SKILL.md) | Punto de entrada: arquitectura, reglas clave y datos rápidos |
| [`references/guante-firmware.md`](.claude/skills/guante-juego/references/guante-firmware.md) | Cableado, subir firmware, sensor, modos flechas/mouse, ajustes del guante |
| [`references/conexion-juego.md`](.claude/skills/guante-juego/references/conexion-juego.md) | Protocolo serie, `SensorService`, panel F5/F6, Electron, diagnóstico |
| [`references/vistas-configuracion.md`](.claude/skills/guante-juego/references/vistas-configuracion.md) | Escenas, controles, Configuración, agregar ajustes, vistas o niveles |

**Cómo usarlo:**

- **Claude Code:** no hay que hacer nada. Al abrir esta carpeta, Claude Code detecta el skill
  y lo usa automáticamente cuando la tarea tiene que ver con el guante, los controles o la
  configuración. También se puede pedir directamente: *"usa el skill guante-juego"*.
- **Otras IA:** pedirle al empezar:
  > Lee `.claude/skills/guante-juego/SKILL.md` y sigue sus indicaciones antes de modificar el proyecto.

  Si la IA no puede leer archivos del repositorio, copiar y pegar el contenido de `SKILL.md`
  y del archivo de `references/` que corresponda a la tarea.

Si cambias cómo funciona el guante o la conexión, actualiza también el skill para que siga
siendo correcto.
