// Conexión con el guante (ESP32-S3 + MPU6050) y panel de lecturas en pantalla.
//
// SensorService: se conecta a la placa por USB con Web Serial (solo Chrome / Edge),
//   lee las líneas que imprime el ESP32 y le envía órdenes (GET, SET, CAL).
// SensorHud: panel con las lecturas. F5 lo muestra/oculta, F6 lo pausa.
//
// Línea de datos que manda el ESP32:
// "Incl X:  12.3 Y:  -4.0 | Acel(g) X: 0.10 Y:-0.20 Z: 0.98 | Giro X:   1.0 Y:   0.5 Z:  -0.2 | Flechas"
// Respuesta a GET / SET / CAL:
// "CFG:{"mode":1,"keySpeed":50,...}"

export interface SensorReading {
  roll: number;   // inclinación izquierda/derecha (°)
  pitch: number;  // inclinación adelante/atrás (°)
  ax: number; ay: number; az: number;  // aceleración (g)
  gx: number; gy: number; gz: number;  // giro (°/s)
  mode: string;
}

export interface GloveConfig {
  mode: number;        // 0 = desactivado, 1 = flechas, 2 = mouse
  keyAngle: number;    // grados para activar una flecha
  keySpeed: number;    // velocidad en modo flechas (%)
  mouseSpeed: number;
  deadZone: number;
  invertX: number;
  invertY: number;
  printMs: number;
  [k: string]: number;
}

export type ConnState = 'on' | 'off' | 'warn';

const LINE_RE =
  /Incl X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) \| Acel\(g\) X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) Z:\s*(-?[\d.]+) \| Giro X:\s*(-?[\d.]+) Y:\s*(-?[\d.]+) Z:\s*(-?[\d.]+) \| (\S+)/;

// ======================= Conexión con la placa =======================
class SensorServiceImpl {
  latest: SensorReading | null = null;
  config: GloveConfig | null = null;
  statusText = 'Sin conectar';
  state: ConnState = 'off';

  private port: any = null;
  private reader: any = null;
  private lastData = 0;
  private connecting = false;
  private userClosed = false;  // si se pulsó "Desconectar", no reconectar solo
  private listeners = new Set<() => void>();

  get supported(): boolean { return !!(navigator as any).serial; }
  get connected(): boolean { return !!this.port; }

  init(): void {
    if (!this.supported) {
      this.setStatus('Usa Chrome o Edge para conectar el guante', 'off');
      return;
    }
    // Reconectar solo si la placa ya se había autorizado antes,
    // y seguir reintentando cada 2 s si el puerto estaba ocupado o se desconectó
    this.tryAutoConnect();
    setInterval(() => this.tryAutoConnect(), 2000);
    (navigator as any).serial.addEventListener('connect', () => this.tryAutoConnect());

    // Avisar si la placa está conectada pero no manda datos
    setInterval(() => {
      if (this.port && Date.now() - this.lastData > 2000) {
        this.setStatus('Conectado, pero sin datos', 'warn');
      }
    }, 1000);

    // Liberar el puerto al recargar o cerrar la página
    window.addEventListener('beforeunload', () => {
      try { this.reader?.cancel(); } catch { /* nada */ }
      try { this.port?.close(); } catch { /* nada */ }
    });
  }

  /** Avisa cada vez que llega una lectura, cambia la conexión o la configuración. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  private setStatus(text: string, state: ConnState): void {
    this.statusText = text;
    this.state = state;
    this.emit();
  }

  /** Abre la ventana de Chrome para elegir la placa (necesita un clic del usuario). */
  async connect(): Promise<void> {
    if (!this.supported || this.port) return;
    this.userClosed = false;
    try {
      // 0x303A = Espressif (ESP32)
      const port = await (navigator as any).serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
      await this.open(port, false);
    } catch {
      // el usuario cerró la ventana sin elegir
    }
  }

  async disconnect(): Promise<void> {
    this.userClosed = true;
    await this.close();
  }

  /** Envía una orden de texto a la placa (GET, CAL, SET clave=valor ...). */
  async send(cmd: string): Promise<void> {
    if (!this.port?.writable) return;
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(cmd + '\n'));
    } finally {
      writer.releaseLock();
    }
  }

  setConfig(values: Partial<GloveConfig>): Promise<void> {
    const pairs = Object.entries(values).map(([k, v]) => `${k}=${Math.round(Number(v))}`);
    return this.send('SET ' + pairs.join(' '));
  }

  calibrate(): Promise<void> {
    return this.send('CAL');
  }

  private async tryAutoConnect(): Promise<void> {
    if (this.port || this.connecting || this.userClosed) return;
    const ports: any[] = await (navigator as any).serial.getPorts();
    if (ports.length > 0) {
      await this.open(ports[0], true);
    } else if (this.state === 'off') {
      this.setStatus('Sin conectar: ve a Configuración → Guante', 'off');
    }
  }

  private async open(port: any, auto: boolean): Promise<void> {
    this.connecting = true;
    try {
      await port.open({ baudRate: 115200 });
    } catch (err: any) {
      this.connecting = false;
      if (err?.name === 'InvalidStateError') { try { await port.close(); } catch { /* nada */ } }
      this.setStatus(auto
        ? 'Puerto ocupado, reintentando… (¿monitor serial abierto?)'
        : 'No se pudo abrir el puerto (¿monitor serial abierto?)', 'warn');
      return;
    }
    this.connecting = false;
    this.port = port;
    this.lastData = Date.now();
    this.setStatus('Conectado, esperando datos…', 'warn');
    port.addEventListener('disconnect', () => this.close());
    this.readLoop();
    setTimeout(() => this.send('GET'), 300);  // pedir la configuración actual
  }

  private async close(): Promise<void> {
    const port = this.port;
    this.port = null;
    try { await this.reader?.cancel(); } catch { /* ya cerrado */ }
    try { await port?.close(); } catch { /* ya cerrado */ }
    this.reader = null;
    this.latest = null;
    this.config = null;
    this.setStatus(this.userClosed ? 'Desconectado' : 'Sin conectar', 'off');
  }

  private async readLoop(): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    while (this.port?.readable) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            this.handleLine(buffer.slice(0, nl).trim());
            buffer = buffer.slice(nl + 1);
          }
          if (buffer.length > 2000) buffer = '';
        }
      } catch {
        break;  // placa desconectada
      } finally {
        this.reader?.releaseLock();
      }
    }
    if (this.port) this.close();
  }

  private handleLine(line: string): void {
    if (line.startsWith('CFG:')) {
      try {
        this.config = JSON.parse(line.slice(4));
        this.emit();
      } catch { /* línea incompleta */ }
      return;
    }
    if (line.includes('no detectado')) {
      this.lastData = Date.now();
      this.setStatus('MPU6050 no detectado: revisa los cables', 'warn');
      return;
    }
    const m = LINE_RE.exec(line);
    if (!m) return;
    const n = m.slice(1, 9).map(Number);
    this.latest = {
      roll: n[0], pitch: n[1], ax: n[2], ay: n[3], az: n[4],
      gx: n[5], gy: n[6], gz: n[7], mode: m[9],
    };
    this.lastData = Date.now();
    if (!this.config) this.send('GET');  // firmware listo pero aún sin configuración
    this.statusText = 'Conectado';
    this.state = 'on';
    this.emit();
  }
}

export const SensorService = new SensorServiceImpl();

// ======================= Panel de lecturas (F5 / F6) =======================
const MAX_TILT = 45;  // grados que llevan el punto hasta el borde del círculo

const CSS = `
#sensor-hud {
  position: fixed; left: 12px; bottom: 12px; z-index: 1000;
  width: 230px; padding: 10px 12px; border-radius: 12px;
  background: rgba(16, 10, 40, 0.85); border: 2px solid #673ab7;
  font: 13px 'Outfit', 'Inter', sans-serif; color: #e0e0e0;
  box-shadow: 0 4px 20px rgba(0,0,0,.5); user-select: none; pointer-events: none;
}
#sensor-hud.hidden { display: none; }
#sensor-hud .hdr { display: flex; align-items: center; gap: 6px; }
#sensor-hud .title { font-weight: 700; color: #ffc107; flex: 1; }
#sensor-hud .status { font-size: 12px; color: #b0bec5; margin: 6px 0; }
#sensor-hud .status.paused { color: #ffa000; font-weight: 700; }
#sensor-hud .main { display: flex; gap: 10px; align-items: center; }
#sensor-hud .tilt div { line-height: 1.5; }
#sensor-hud .v { color: #4fc3f7; font-weight: 600; font-variant-numeric: tabular-nums; }
#sensor-hud table { width: 100%; margin-top: 8px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
#sensor-hud th { color: #9e9e9e; font-weight: 400; text-align: left; }
#sensor-hud td { color: #4fc3f7; text-align: right; }
#sensor-hud .mode { margin-top: 6px; color: #ffca28; }
#sensor-hud .keys { margin-top: 4px; font-size: 11px; color: #777; }

.sensor-dot { width: 9px; height: 9px; border-radius: 50%; background: #757575; flex: none; }
.sensor-dot.on { background: #00e676; box-shadow: 0 0 6px #00e676; }
.sensor-dot.warn { background: #ffa000; }
.sensor-level {
  position: relative; width: 74px; height: 74px; flex: none; border-radius: 50%;
  background: radial-gradient(circle, #1f1446 0%, #120b2e 100%);
  border: 2px solid #4fc3f7;
}
.sensor-level::before, .sensor-level::after {
  content: ''; position: absolute; background: rgba(79,195,247,.25);
}
.sensor-level::before { left: 50%; top: 4px; bottom: 4px; width: 1px; }
.sensor-level::after { top: 50%; left: 4px; right: 4px; height: 1px; }
.sensor-ball {
  position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px;
  left: 50%; top: 50%; border-radius: 50%; background: #ffc107;
  box-shadow: 0 0 8px #ffc107; transition: left .08s linear, top .08s linear;
}
`;

/** Mueve el punto del nivel de burbuja según la inclinación. */
export function placeBall(ball: HTMLElement, r: SensorReading | null): void {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / MAX_TILT));
  ball.style.left = `${50 + (r ? clamp(r.roll) : 0) * 42}%`;
  ball.style.top = `${50 + (r ? clamp(r.pitch) : 0) * 42}%`;
}

class SensorHudImpl {
  private root!: HTMLDivElement;
  private paused = false;

  init(): void {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'sensor-hud';
    this.root.className = 'hidden';  // oculto hasta presionar F5
    this.root.innerHTML = `
      <div class="hdr">
        <span class="sensor-dot" data-k="dot"></span>
        <span class="title">🧤 Sensor del guante</span>
      </div>
      <div class="status" data-k="status"></div>
      <div class="main">
        <div class="sensor-level"><div class="sensor-ball" data-k="ball"></div></div>
        <div class="tilt">
          <div>Incl. X: <span class="v" data-k="roll">–</span></div>
          <div>Incl. Y: <span class="v" data-k="pitch">–</span></div>
        </div>
      </div>
      <table>
        <tr><th></th><th style="text-align:right">X</th><th style="text-align:right">Y</th><th style="text-align:right">Z</th></tr>
        <tr><th>Acel (g)</th><td data-k="ax">–</td><td data-k="ay">–</td><td data-k="az">–</td></tr>
        <tr><th>Giro (°/s)</th><td data-k="gx">–</td><td data-k="gy">–</td><td data-k="gz">–</td></tr>
      </table>
      <div class="mode">Modo: <span data-k="mode">–</span></div>
      <div class="keys">F5 ocultar · F6 pausar</div>`;
    document.body.appendChild(this.root);

    // F5: mostrar / ocultar el panel (en vez de recargar la página; Ctrl+F5 sigue recargando)
    // F6: pausar / continuar las lecturas (P no se usa: pasa de nivel)
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        this.root.classList.toggle('hidden');
      } else if (e.key === 'F6') {
        e.preventDefault();  // evita que el navegador salte a la barra de direcciones
        this.paused = !this.paused;
        this.render();
      }
    }, true);

    SensorService.onChange(() => this.render());
    this.render();
  }

  private el(k: string): HTMLElement {
    return this.root.querySelector(`[data-k="${k}"]`) as HTMLElement;
  }

  private render(): void {
    const dot = this.el('dot');
    dot.classList.toggle('on', SensorService.state === 'on');
    dot.classList.toggle('warn', SensorService.state === 'warn');

    const status = this.el('status');
    status.classList.toggle('paused', this.paused);
    status.textContent = this.paused ? '⏸ Pausado (F6 para continuar)' : SensorService.statusText;
    if (this.paused) return;  // en pausa los valores quedan congelados

    const r = SensorService.latest;
    const f = (v: number | undefined, d: number) => (v === undefined ? '–' : v.toFixed(d));
    this.el('roll').textContent = r ? `${r.roll.toFixed(1)}°` : '–';
    this.el('pitch').textContent = r ? `${r.pitch.toFixed(1)}°` : '–';
    this.el('ax').textContent = f(r?.ax, 2);
    this.el('ay').textContent = f(r?.ay, 2);
    this.el('az').textContent = f(r?.az, 2);
    this.el('gx').textContent = f(r?.gx, 0);
    this.el('gy').textContent = f(r?.gy, 0);
    this.el('gz').textContent = f(r?.gz, 0);
    this.el('mode').textContent = r?.mode ?? '–';
    placeBall(this.el('ball'), r);
  }
}

export const SensorHud = new SensorHudImpl();
