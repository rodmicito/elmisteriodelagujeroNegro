# Misterio en el Agujero Negro - Resumen del Proyecto

Este documento describe las partes más importantes y centrales del videojuego.
Para la explicación completa (incluido el guante con sensor) ver **[DOCUMENTACION.md](DOCUMENTACION.md)**.

## 1. Tecnologías Principales
- **TypeScript**: El lenguaje de programación que controla toda la lógica y reglas del juego.
- **Phaser 3**: El motor de físicas y gráficos que da vida a las colisiones, el dibujo de la nave y la gravedad.
- **Vite**: Ejecuta el juego en modo desarrollo y lo empaqueta para publicarlo.
- **Electron** y **Capacitor**: Convierten el juego en programa de Windows (`.exe`) y en app de Android (APK).
- **ESP32-S3 + MPU6050**: El guante con sensor de movimiento que permite controlar el juego inclinando la mano.

## 2. Archivos y Escenas Clave
El juego está dividido en "Escenas", que son los diferentes archivos donde ocurre la acción:

- **`BootScene.ts`**: La primera escena. Deja configurado el juego para el control táctil o con mouse (la nave sigue el dedo o el cursor) y pasa directamente a la carga.
- **`MainMenuScene.ts`**: El menú principal donde puedes elegir ir a la enciclopedia, ver tus medallas, abrir la configuración o iniciar los niveles.
- **`GameScene.ts` (Nivel 1)**: Nivel del agujero negro. Destaca por el uso de Gravedad Atractiva (física). La fuerza de atracción se puede ajustar en Configuración → Guante.
- **`Level2Scene.ts` (Nivel 2)**: Nivel de la enana roja. Destaca por la generación de asteroides y obstáculos móviles.
- **`Level3Scene.ts` (Nivel 3)**: Nivel de la constelación. Destaca por el dibujo de líneas interactivo para trazar estrellas.
- **`Level4Scene.ts` (Nivel 4)**: Nivel del agujero de gusano. Runner vertical donde esquivas anomalías.
- **`Level5Scene.ts` (Nivel 5)**: Nivel del nacimiento del agujero negro. Hay que girar tres estaciones deflectoras hasta alinear sus haces con la estrella para provocar la supernova.
- **`ConfigScene.ts`** y **`GloveConfigScene.ts`**: Configuración de sonido y progreso, y la pantalla para conectar y ajustar el guante.
- **`sensor/SensorHud.ts`**: Conexión con el guante por USB y panel con las lecturas del sensor (tecla F5).

## 3. Características Especiales

- **Arte por Código**: No requiere descargar imágenes externas para la nave o los asteroides; todo se dibuja matemáticamente (con `Phaser.GameObjects.Graphics`), haciendo que el juego cargue al instante.
- **Preguntas Interactivas**: Los niveles se pausan y te hacen preguntas sobre el espacio. Tienes que responder correctamente para avanzar, dándole su aspecto educativo.
- **Insignias y Progreso Local**: Al superar niveles, ganas medallas que se guardan en el `localStorage` de tu navegador gracias al archivo `StorageService.ts`. No pierdes tu progreso al salir, y "Comenzar" te lleva al último nivel desbloqueado.
- **Multiplataforma (PC y Móvil)**: La nave sigue tu dedo o el cursor mientras tocas la pantalla o mantienes el clic. Cuando no estás tocando, funcionan las flechas del teclado. Existe además un modo de botones táctiles virtuales (`virtual_buttons`), que hoy no está activado.
- **Control con Guante**: Un guante con un ESP32-S3 y un sensor MPU6050 se conecta por USB y la computadora lo reconoce como teclado y mouse: inclinar la mano mueve la nave o el cursor. Desde Configuración → Guante se ven las lecturas en vivo y se ajustan velocidad, sensibilidad y modo.
- **Atajos**: **P** pasa el nivel actual, **F5** muestra el panel del sensor y **F6** lo pausa.

## 4. Despliegue (Cómo se publica)
El proyecto puede ejecutarse en varias plataformas:
- **Web (`Dockerfile`)**: Compila el juego con Vite y lo publica con un servidor Nginx, ideal para ser alojado en **Dockploy**.
- **Escritorio (`electron/`)**: `npm run desktop:build` genera el programa para Windows.
- **Android (`android/`)**: Al subir cambios a la rama `apk`, GitHub Actions compila el APK automáticamente.
- **Guante (`hardware/guante-esp32/`)**: El firmware se sube al ESP32-S3 con PlatformIO.

## 5. Código Principal (`main.ts`)
Este es el "punto de entrada" del juego, que carga las configuraciones, establece el motor de físicas, inicia todas las pantallas y la conexión con el guante:

```typescript
import Phaser from 'phaser';
import './style.css';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { GameScene } from './scenes/GameScene';
import { Level2Scene } from './scenes/Level2Scene';
import { Level3Scene } from './scenes/Level3Scene';
import { Level4Scene } from './scenes/Level4Scene';
import { Level5Scene } from './scenes/Level5Scene';
import { EncyclopediaScene } from './scenes/EncyclopediaScene';
import { BadgesScene } from './scenes/BadgesScene';
import { ConfigScene } from './scenes/ConfigScene';
import { CreditsScene } from './scenes/CreditsScene';
import { GloveConfigScene } from './scenes/GloveConfigScene';
import { SensorHud, SensorService } from './sensor/SensorHud';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 576,
  parent: 'game-container',
  backgroundColor: '#0a051b',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false
    }
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [
    BootScene,
    PreloadScene,
    MainMenuScene,
    GameScene,
    Level2Scene,
    Level3Scene,
    Level4Scene,
    Level5Scene,
    EncyclopediaScene,
    BadgesScene,
    ConfigScene,
    GloveConfigScene,
    CreditsScene
  ]
};

// Se inicia el motor cuando carga la página web
window.addEventListener('load', () => {
  new Phaser.Game(config);
  SensorHud.init();      // panel con las lecturas del guante (F5 / F6)
  SensorService.init();  // conexión con el guante (ESP32 + MPU6050)
});
```
