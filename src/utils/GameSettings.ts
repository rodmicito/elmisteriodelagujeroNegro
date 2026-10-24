// Ajustes de juego que no son progreso (se guardan aparte en el navegador).

const KEY = 'el_misterio_del_agujero_negro_settings';

interface Settings {
  gravityPercent: number;  // fuerza de atracción del agujero negro en el nivel 1 (%)
}

const DEFAULTS: Settings = {
  gravityPercent: 50,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* sin almacenamiento: se usa el valor por defecto */ }
}

export const GameSettings = {
  getGravityPercent(): number {
    return load().gravityPercent;
  },
  setGravityPercent(value: number): void {
    const s = load();
    s.gravityPercent = Math.max(10, Math.min(150, Math.round(value)));
    save(s);
  },
};
