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

// Start the game when the window loads
window.addEventListener('load', () => {
  new Phaser.Game(config);
  SensorHud.init();      // panel con las lecturas del guante (F5 / F6)
  SensorService.init();  // conexión con el guante (ESP32 + MPU6050)
});
