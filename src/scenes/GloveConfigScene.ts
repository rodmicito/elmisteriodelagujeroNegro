import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { SensorService, placeBall } from '../sensor/SensorHud';
import { GameSettings } from '../utils/GameSettings';

// Pantalla "Configuración → Guante": conectar el guante, ver la lectura en vivo,
// cambiar sus ajustes (se guardan en el ESP32) y la atracción del nivel 1.

const CSS = `
#glove-config {
  position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 900;
  width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto;
  padding: 20px 24px; border-radius: 16px;
  background: rgba(26, 18, 53, 0.97); border: 4px solid #673ab7;
  font: 15px 'Outfit', 'Inter', sans-serif; color: #e0e0e0; user-select: none;
}
#glove-config h1 { font-size: 28px; color: #ffc107; text-align: center; margin-bottom: 14px; }
#glove-config h2 { font-size: 16px; color: #b3e5fc; margin: 18px 0 8px; }
#glove-config .conn { display: flex; align-items: center; gap: 10px; }
#glove-config .conn .txt { flex: 1; }
#glove-config button {
  background: #673ab7; color: #fff; border: 0; border-radius: 8px;
  padding: 8px 14px; font: 600 14px 'Outfit', 'Inter', sans-serif; cursor: pointer;
}
#glove-config button:hover { filter: brightness(1.15); }
#glove-config button:disabled { opacity: .4; cursor: default; filter: none; }
#glove-config .live { display: flex; align-items: center; gap: 16px; margin-top: 12px; }
#glove-config .live .v { color: #4fc3f7; font-weight: 700; font-variant-numeric: tabular-nums; }
#glove-config .row { display: grid; grid-template-columns: 1fr 170px 46px; align-items: center; gap: 10px; margin: 8px 0; }
#glove-config .row .val { text-align: right; color: #ffca28; font-variant-numeric: tabular-nums; }
#glove-config input[type=range] { width: 100%; accent-color: #ffa500; }
#glove-config .modes { display: flex; gap: 6px; }
#glove-config .modes button { flex: 1; background: #312450; }
#glove-config .modes button.sel { background: #ffa500; color: #1a1235; }
#glove-config label.chk { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
#glove-config label.chk input { width: 18px; height: 18px; accent-color: #00e676; }
#glove-config .hint { font-size: 12px; color: #9e9e9e; }
#glove-config .disabled { opacity: .45; pointer-events: none; }
#glove-config .back { display: block; margin: 20px auto 0; background: #ff5722; padding: 10px 40px; font-size: 18px; }
`;

export class GloveConfigScene extends Phaser.Scene {
  private root?: HTMLDivElement;
  private style?: HTMLStyleElement;
  private unsubscribe?: () => void;

  constructor() {
    super('GloveConfigScene');
  }

  create(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Fondo igual al de Configuración
    const bg = this.add.graphics();
    bg.fillStyle(0x0a051b, 1);
    bg.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) {
      this.add.circle(Phaser.Math.Between(0, width), Phaser.Math.Between(0, height),
        Phaser.Math.FloatBetween(0.5, 2), 0xffffff, Phaser.Math.FloatBetween(0.1, 0.6));
    }

    this.buildDom();
    this.unsubscribe = SensorService.onChange(() => this.refresh());
    this.refresh();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.root?.remove();
      this.style?.remove();
    });
  }

  private buildDom(): void {
    this.style = document.createElement('style');
    this.style.textContent = CSS;
    document.head.appendChild(this.style);

    const root = document.createElement('div');
    root.id = 'glove-config';
    root.innerHTML = `
      <h1>🧤 GUANTE</h1>

      <div class="conn">
        <span class="sensor-dot" data-k="dot"></span>
        <span class="txt" data-k="status">–</span>
        <button data-k="connect">Conectar</button>
      </div>
      <div class="live">
        <div class="sensor-level"><div class="sensor-ball" data-k="ball"></div></div>
        <div>
          <div>Inclinación X: <span class="v" data-k="roll">–</span></div>
          <div>Inclinación Y: <span class="v" data-k="pitch">–</span></div>
          <button data-k="cal" style="margin-top:8px">Calibrar centro</button>
          <div class="hint">Pon la mano en posición de reposo y pulsa Calibrar</div>
        </div>
      </div>

      <div data-k="gloveOpts">
        <h2>Control</h2>
        <div class="modes">
          <button data-mode="1">Flechas</button>
          <button data-mode="2">Mouse</button>
          <button data-mode="0">Desactivado</button>
        </div>
        <div class="hint" style="margin-top:4px">Flechas: niveles 1, 2 y 4 · Mouse: nivel 3 y menús · Doble pulsación de BOOT también cambia el modo</div>

        <div class="row"><span>Velocidad de la nave</span>
          <input type="range" min="10" max="100" step="5" data-cfg="keySpeed"><span class="val" data-val="keySpeed">–</span></div>
        <div class="row"><span>Inclinación para moverse (°)</span>
          <input type="range" min="3" max="40" step="1" data-cfg="keyAngle"><span class="val" data-val="keyAngle">–</span></div>
        <div class="row"><span>Velocidad del cursor</span>
          <input type="range" min="1" max="30" step="1" data-cfg="mouseSpeed"><span class="val" data-val="mouseSpeed">–</span></div>
        <div class="row"><span>Zona muerta del cursor (°)</span>
          <input type="range" min="0" max="30" step="1" data-cfg="deadZone"><span class="val" data-val="deadZone">–</span></div>

        <label class="chk"><input type="checkbox" data-cfg="invertX"> Invertir izquierda / derecha</label>
        <label class="chk"><input type="checkbox" data-cfg="invertY"> Invertir adelante / atrás</label>
        <div class="hint">Estos ajustes se guardan en el guante</div>
      </div>

      <h2>Juego</h2>
      <div class="row"><span>Atracción del agujero negro (nivel 1)</span>
        <input type="range" min="10" max="150" step="5" data-k="gravity"><span class="val" data-k="gravityVal">–</span></div>
      <div class="hint">Menos % = es más fácil escapar del agujero negro</div>

      <button class="back" data-k="back">VOLVER</button>`;
    document.body.appendChild(root);
    this.root = root;

    // Que los clics en el formulario no lleguen al juego
    root.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.el('connect').addEventListener('click', () => {
      AudioService.playSFX('click');
      if (SensorService.connected) SensorService.disconnect(); else SensorService.connect();
    });

    this.el('cal').addEventListener('click', () => {
      AudioService.playSFX('click');
      SensorService.calibrate();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        AudioService.playSFX('click');
        SensorService.setConfig({ mode: Number(btn.dataset.mode) });
      });
    });

    // Ajustes del guante: el valor se muestra al mover y se envía al soltar
    root.querySelectorAll<HTMLInputElement>('input[data-cfg]').forEach((input) => {
      const key = input.dataset.cfg!;
      if (input.type === 'checkbox') {
        input.addEventListener('change', () => SensorService.setConfig({ [key]: input.checked ? 1 : 0 }));
      } else {
        input.addEventListener('input', () => { this.valEl(key).textContent = input.value; });
        input.addEventListener('change', () => SensorService.setConfig({ [key]: Number(input.value) }));
      }
    });

    // Atracción del nivel 1 (se guarda en el navegador)
    const gravity = this.el('gravity') as HTMLInputElement;
    gravity.value = String(GameSettings.getGravityPercent());
    this.el('gravityVal').textContent = `${gravity.value}%`;
    gravity.addEventListener('input', () => {
      this.el('gravityVal').textContent = `${gravity.value}%`;
      GameSettings.setGravityPercent(Number(gravity.value));
    });

    this.el('back').addEventListener('click', () => {
      AudioService.playSFX('click');
      this.cameras.main.fadeOut(300, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('ConfigScene');
      });
    });
  }

  private el(k: string): HTMLElement {
    return this.root!.querySelector(`[data-k="${k}"]`) as HTMLElement;
  }

  private valEl(k: string): HTMLElement {
    return this.root!.querySelector(`[data-val="${k}"]`) as HTMLElement;
  }

  private refresh(): void {
    if (!this.root) return;
    const connected = SensorService.connected;

    const dot = this.el('dot');
    dot.classList.toggle('on', SensorService.state === 'on');
    dot.classList.toggle('warn', SensorService.state === 'warn');
    this.el('status').textContent = SensorService.supported
      ? (connected ? SensorService.statusText : 'Guante sin conectar')
      : SensorService.statusText;

    const btn = this.el('connect') as HTMLButtonElement;
    btn.textContent = connected ? 'Desconectar' : 'Conectar';
    btn.disabled = !SensorService.supported;

    const r = SensorService.latest;
    this.el('roll').textContent = r ? `${r.roll.toFixed(1)}°` : '–';
    this.el('pitch').textContent = r ? `${r.pitch.toFixed(1)}°` : '–';
    placeBall(this.el('ball'), r);
    (this.el('cal') as HTMLButtonElement).disabled = !r;

    // Ajustes del guante: solo editables si llegó su configuración
    const cfg = SensorService.config;
    this.el('gloveOpts').classList.toggle('disabled', !cfg);
    if (!cfg) return;

    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
      b.classList.toggle('sel', Number(b.dataset.mode) === cfg.mode);
    });
    this.root.querySelectorAll<HTMLInputElement>('input[data-cfg]').forEach((input) => {
      if (document.activeElement === input) return;  // no pisar lo que el usuario está moviendo
      const key = input.dataset.cfg!;
      if (input.type === 'checkbox') {
        input.checked = !!cfg[key];
      } else {
        input.value = String(cfg[key]);
        this.valEl(key).textContent = String(cfg[key]);
      }
    });
  }
}
