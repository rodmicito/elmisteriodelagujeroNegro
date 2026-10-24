#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Wire.h>
#include <Preferences.h>
#include <USB.h>
#include <USBHIDKeyboard.h>
#include <USBHIDMouse.h>

// ---- Configuración del Access Point ----
const char *AP_SSID = "ESP32S3-SuperMini";
const char *AP_PASS = "12345678";  // mínimo 8 caracteres

IPAddress apIP(192, 168, 4, 1);
IPAddress apGateway(192, 168, 4, 1);
IPAddress apMask(255, 255, 255, 0);

// ---- MPU6050 ----
// Conexión: VCC->3V3, GND->GND, SDA->GPIO8, SCL->GPIO9, AD0->GND (o sin conectar)
const int I2C_SDA = 8;
const int I2C_SCL = 9;
const uint8_t MPU_ADDR = 0x68;

// ---- Botón BOOT de la placa ----
// Modo mouse: mantener presionado = clic izquierdo (sirve para arrastrar)
// Doble pulsación rápida: cambia entre modo flechas y modo mouse
const int BTN_PIN = 0;

// ---- Modos de control ----
enum Mode : uint8_t { MODE_OFF = 0, MODE_KEYS = 1, MODE_MOUSE = 2 };
const char *MODE_NAMES[] = {"Desactivado", "Flechas", "Mouse"};

// ---- Ajustes (se guardan en la memoria flash) ----
struct Settings {
  uint8_t accelRange;   // 0=±2g, 1=±4g, 2=±8g, 3=±16g
  uint8_t gyroRange;    // 0=±250, 1=±500, 2=±1000, 3=±2000 °/s
  uint8_t filter;       // 0..6 = 260, 184, 94, 44, 21, 10, 5 Hz
  uint16_t readMs;      // cada cuánto se lee el sensor
  uint16_t printMs;     // cada cuánto se imprime por serial (0 = no imprimir)
  uint8_t mode;         // Mode
  uint8_t keyAngle;     // grados de inclinación para presionar una flecha
  uint8_t mouseSpeed;   // velocidad del cursor (1..30)
  uint8_t deadZone;     // grados sin movimiento del cursor alrededor del centro
  bool invertX;
  bool invertY;
  float offRoll;        // calibración: posición de reposo
  float offPitch;
  uint8_t keySpeed;     // velocidad máxima en modo flechas (10..100 %)
};
Settings cfg = {0, 0, 3, 10, 100, MODE_KEYS, 15, 10, 4, false, false, 0, 0, 50};
Preferences prefs;

// ---- Estado ----
bool mpuOk = false;
float ax, ay, az;      // aceleración en g
float gx, gy, gz;      // giro en °/s
float tempC;
float roll = 0, pitch = 0;  // inclinación en grados (ya calibrada)
float rawRoll = 0, rawPitch = 0;
bool anglesReady = false;

USBHIDKeyboard Keyboard;
USBHIDMouse Mouse;
WebServer server(80);

// ---------------- Guardar / cargar ajustes ----------------
void loadSettings() {
  prefs.begin("ctrl", true);
  if (prefs.getBytesLength("cfg") == sizeof(Settings)) {
    prefs.getBytes("cfg", &cfg, sizeof(Settings));
  }
  prefs.end();
}

void saveSettings() {
  prefs.begin("ctrl", false);
  prefs.putBytes("cfg", &cfg, sizeof(Settings));
  prefs.end();
}

// ---------------- MPU6050 ----------------
void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void mpuApplySettings() {
  mpuWrite(0x1A, cfg.filter);           // CONFIG: filtro pasa bajos
  mpuWrite(0x1B, cfg.gyroRange << 3);   // GYRO_CONFIG
  mpuWrite(0x1C, cfg.accelRange << 3);  // ACCEL_CONFIG
}

bool mpuInit() {
  Wire.beginTransmission(MPU_ADDR);
  if (Wire.endTransmission() != 0) return false;
  mpuWrite(0x6B, 0x00);  // despertar el sensor
  delay(50);
  mpuApplySettings();
  anglesReady = false;
  return true;
}

bool mpuRead() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, (uint8_t)14) != 14) return false;

  int16_t raw[7];
  for (int i = 0; i < 7; i++) {
    raw[i] = (Wire.read() << 8) | Wire.read();
  }
  float aScale = 16384.0f / (1 << cfg.accelRange);
  float gScale = 131.0f / (1 << cfg.gyroRange);
  ax = raw[0] / aScale;
  ay = raw[1] / aScale;
  az = raw[2] / aScale;
  tempC = raw[3] / 340.0f + 36.53f;
  gx = raw[4] / gScale;
  gy = raw[5] / gScale;
  gz = raw[6] / gScale;
  return true;
}

// Lleva un ángulo al rango -180..180 (para que no salte al pasar por ±180°)
float wrap180(float a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// Calcula la inclinación combinando acelerómetro (estable) y giroscopio (rápido)
void updateAngles(float dt) {
  float accRoll = atan2f(ay, az) * RAD_TO_DEG;
  float accPitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * RAD_TO_DEG;
  if (!anglesReady) {
    rawRoll = accRoll;
    rawPitch = accPitch;
    anglesReady = true;
  } else {
    float predRoll = rawRoll + gx * dt;
    float predPitch = rawPitch + gy * dt;
    rawRoll = wrap180(predRoll + 0.04f * wrap180(accRoll - predRoll));
    rawPitch = wrap180(predPitch + 0.04f * wrap180(accPitch - predPitch));
  }
  roll = wrap180(rawRoll - cfg.offRoll);
  pitch = wrap180(rawPitch - cfg.offPitch);
}

void calibrate() {
  cfg.offRoll = rawRoll;
  cfg.offPitch = rawPitch;
  Serial.println("Calibrado: posición actual = centro");
}

// ---------------- Control USB (teclado / mouse) ----------------
bool keyDown[4] = {false, false, false, false};    // tecla presionada ahora (izq, der, arriba, abajo)
bool keyActive[4] = {false, false, false, false};  // inclinación pasó el umbral
const uint8_t KEYS[4] = {KEY_LEFT_ARROW, KEY_RIGHT_ARROW, KEY_UP_ARROW, KEY_DOWN_ARROW};
bool mouseBtnDown = false;
float mouseAccX = 0, mouseAccY = 0;

void releaseAll() {
  for (int i = 0; i < 4; i++) {
    if (keyDown[i]) Keyboard.release(KEYS[i]);
    keyDown[i] = false;
    keyActive[i] = false;
  }
  if (mouseBtnDown) Mouse.release(MOUSE_LEFT);
  mouseBtnDown = false;
  mouseAccX = mouseAccY = 0;
}

void setMode(uint8_t m) {
  releaseAll();
  cfg.mode = m;
  saveSettings();
  Serial.printf("Modo: %s\n", MODE_NAMES[cfg.mode]);
}

// Presiona una flecha "a pulsos": cuanto más se inclina, más tiempo queda presionada.
// Así la nave gira lento con poca inclinación y rápido con mucha.
const unsigned long PULSE_MS = 80;  // duración de un ciclo presionar/soltar

void setKey(int i, float value) {
  float on = cfg.keyAngle;
  float off = cfg.keyAngle * 0.7f;  // histéresis para que no "tiemble"
  if (!keyActive[i] && value > on) keyActive[i] = true;
  else if (keyActive[i] && value < off) keyActive[i] = false;

  bool want = false;
  if (keyActive[i]) {
    // 30 % de fuerza justo en el umbral, 100 % con 30° más de inclinación
    float strength = constrain(0.3f + 0.7f * (value - on) / 30.0f, 0.3f, 1.0f);
    float duty = strength * cfg.keySpeed / 100.0f;
    float phase = (millis() % PULSE_MS) / (float)PULSE_MS;
    want = duty >= 0.99f || phase < duty;
  }

  if (want && !keyDown[i]) {
    Keyboard.press(KEYS[i]);
    keyDown[i] = true;
  } else if (!want && keyDown[i]) {
    Keyboard.release(KEYS[i]);
    keyDown[i] = false;
  }
}

bool calibrated = false;  // no se envían teclas hasta tomar el centro al arrancar

void updateHid(float dt) {
  if (!calibrated) return;
  float x = cfg.invertX ? -roll : roll;    // izquierda(-) / derecha(+)
  float y = cfg.invertY ? -pitch : pitch;  // adelante(-) / atrás(+)

  if (cfg.mode == MODE_KEYS) {
    setKey(0, -x);
    setKey(1, x);
    setKey(2, -y);
    setKey(3, y);
  } else if (cfg.mode == MODE_MOUSE) {
    // Velocidad proporcional a la inclinación, con zona muerta en el centro
    auto speed = [](float a) {
      float dz = cfg.deadZone;
      if (fabsf(a) <= dz) return 0.0f;
      float v = (fabsf(a) - dz) * cfg.mouseSpeed * 2.0f;  // píxeles por segundo
      return a > 0 ? v : -v;
    };
    mouseAccX += speed(x) * dt;
    mouseAccY += speed(y) * dt;
    int dx = constrain((int)mouseAccX, -127, 127);
    int dy = constrain((int)mouseAccY, -127, 127);
    if (dx != 0 || dy != 0) {
      Mouse.move(dx, dy);
      mouseAccX -= dx;
      mouseAccY -= dy;
    }
  }
}

// Botón BOOT: clic en modo mouse, doble pulsación cambia de modo
void updateButton() {
  static bool lastState = false;
  static unsigned long lastChange = 0;
  static unsigned long lastPress = 0;

  bool pressed = digitalRead(BTN_PIN) == LOW;
  if (pressed == lastState || millis() - lastChange < 25) return;  // antirrebote
  lastState = pressed;
  lastChange = millis();

  if (pressed) {
    if (millis() - lastPress < 350) {  // doble pulsación
      if (mouseBtnDown) Mouse.release(MOUSE_LEFT);
      mouseBtnDown = false;
      setMode(cfg.mode == MODE_MOUSE ? MODE_KEYS : MODE_MOUSE);
      lastPress = 0;
      return;
    }
    lastPress = millis();
    if (cfg.mode == MODE_MOUSE) {
      Mouse.press(MOUSE_LEFT);
      mouseBtnDown = true;
    }
  } else if (mouseBtnDown) {
    Mouse.release(MOUSE_LEFT);
    mouseBtnDown = false;
  }
}

// ---------------- Página web ----------------
const char PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Control MPU6050</title>
<style>
  body { font-family: sans-serif; background:#111; color:#eee; padding:16px; margin:0; }
  h1 { font-size:1.3em; text-align:center; }
  .card { background:#222; border-radius:12px; padding:16px; max-width:400px; margin:12px auto; }
  h2 { font-size:1em; margin:0 0 12px; color:#aaa; }
  label { display:block; margin:10px 0 4px; font-size:.9em; color:#ccc; }
  label.chk { display:flex; align-items:center; gap:8px; }
  label.chk input { width:auto; }
  select, input { width:100%; padding:10px; border-radius:8px; border:1px solid #444;
                  background:#111; color:#eee; font-size:1em; box-sizing:border-box; }
  button { width:100%; padding:12px; margin-top:16px; border:0; border-radius:8px;
           background:#1e88e5; color:#fff; font-size:1em; }
  button.sec { background:#455a64; }
  .hint { font-size:.8em; color:#888; margin-top:4px; }
  .row { display:flex; justify-content:space-around; text-align:center; }
  .v { font-size:1.2em; color:#4fc3f7; font-variant-numeric:tabular-nums; }
  .msg { text-align:center; margin-top:10px; min-height:1.2em; }
  .err { color:#ef5350; text-align:center; }
  .mode { text-align:center; font-size:1.3em; color:#ffca28; }
</style>
</head>
<body>
<h1>ESP32-S3 + MPU6050</h1>

<div class="card">
  <h2>Estado</h2>
  <div class="mode">Modo: <span id="mode">-</span></div>
  <div id="err" class="err"></div><br>
  <div class="row">
    <div>Inclinación X<br><span class="v" id="roll">-</span></div>
    <div>Inclinación Y<br><span class="v" id="pitch">-</span></div>
  </div>
  <button type="button" class="sec" id="cal">Calibrar (posición actual = centro)</button>
  <div class="msg" id="calmsg"></div>
</div>

<form id="f">
<div class="card">
  <h2>Control del juego</h2>
  <label>Modo</label>
  <select name="mode">
    <option value="1">Flechas (niveles 1, 2 y 4)</option>
    <option value="2">Mouse (nivel 3 y menús)</option>
    <option value="0">Desactivado</option>
  </select>
  <div class="hint">Doble pulsación del botón BOOT cambia entre Flechas y Mouse</div>

  <label>Inclinación para presionar una flecha (grados)</label>
  <input type="number" name="keyAngle" min="3" max="60">

  <label>Velocidad en modo flechas (%)</label>
  <input type="number" name="keySpeed" min="10" max="100">
  <div class="hint">Menos % = la nave gira y avanza más lento. Con poca inclinación va más lento todavía</div>

  <label>Velocidad del mouse</label>
  <input type="number" name="mouseSpeed" min="1" max="30">

  <label>Zona muerta del mouse (grados)</label>
  <input type="number" name="deadZone" min="0" max="30">
  <div class="hint">Inclinación mínima para que el cursor empiece a moverse</div>

  <label class="chk"><input type="checkbox" name="invertX" value="1"> Invertir izquierda/derecha</label>
  <label class="chk"><input type="checkbox" name="invertY" value="1"> Invertir adelante/atrás</label>
</div>

<div class="card">
  <h2>Ajustes del sensor</h2>
  <label>Rango del acelerómetro</label>
  <select name="accel">
    <option value="0">±2 g (más precisión)</option>
    <option value="1">±4 g</option>
    <option value="2">±8 g</option>
    <option value="3">±16 g (golpes fuertes)</option>
  </select>

  <label>Rango del giroscopio</label>
  <select name="gyro">
    <option value="0">±250 °/s (más precisión)</option>
    <option value="1">±500 °/s</option>
    <option value="2">±1000 °/s</option>
    <option value="3">±2000 °/s (giros rápidos)</option>
  </select>

  <label>Filtro (suavizado)</label>
  <select name="filter">
    <option value="0">260 Hz (sin filtro)</option>
    <option value="1">184 Hz</option>
    <option value="2">94 Hz</option>
    <option value="3">44 Hz</option>
    <option value="4">21 Hz</option>
    <option value="5">10 Hz</option>
    <option value="6">5 Hz (muy suave)</option>
  </select>

  <label>Leer el sensor cada (ms)</label>
  <input type="number" name="readMs" min="5" max="5000">
  <div class="hint">Para jugar se recomienda 10 ms</div>

  <label>Imprimir por serial cada (ms)</label>
  <input type="number" name="printMs" min="0" max="60000">
  <div class="hint">0 = no imprimir por serial</div>

  <button type="submit">Guardar</button>
  <div class="msg" id="msg"></div>
</div>
</form>

<script>
const f = document.getElementById('f');
const $ = id => document.getElementById(id);

async function loadConfig() {
  const c = await (await fetch('/config')).json();
  for (const k in c) {
    const el = f.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!c[k]; else el.value = c[k];
  }
}

f.onsubmit = async (e) => {
  e.preventDefault();
  $('msg').textContent = 'Guardando...';
  try {
    const r = await fetch('/config', { method:'POST', body: new URLSearchParams(new FormData(f)) });
    $('msg').textContent = r.ok ? '✔ Guardado' : '✖ ' + await r.text();
    loadConfig();
  } catch (err) { $('msg').textContent = '✖ Error de conexión'; }
};

$('cal').onclick = async () => {
  $('calmsg').textContent = 'Calibrando...';
  try {
    const r = await fetch('/calibrate', { method:'POST' });
    $('calmsg').textContent = r.ok ? '✔ Calibrado' : '✖ ' + await r.text();
  } catch (err) { $('calmsg').textContent = '✖ Error de conexión'; }
};

let lastMode = null;
async function update() {
  try {
    const d = await (await fetch('/data')).json();
    $('err').textContent = d.ok ? '' : 'MPU6050 no detectado: revisa las conexiones';
    $('roll').textContent = d.roll.toFixed(1) + '°';
    $('pitch').textContent = d.pitch.toFixed(1) + '°';
    $('mode').textContent = d.modeName;
    if (lastMode !== null && lastMode !== d.mode) f.elements.mode.value = d.mode;
    lastMode = d.mode;
  } catch (e) {}
}

loadConfig();
setInterval(update, 300);
update();
</script>
</body>
</html>
)rawliteral";

void handleRoot() {
  server.send_P(200, "text/html", PAGE);
}

void handleData() {
  char json[160];
  snprintf(json, sizeof(json),
           "{\"ok\":%s,\"roll\":%.2f,\"pitch\":%.2f,\"mode\":%u,\"modeName\":\"%s\"}",
           mpuOk ? "true" : "false", roll, pitch, cfg.mode, MODE_NAMES[cfg.mode]);
  server.send(200, "application/json", json);
}

void configJson(char *json, size_t size) {
  snprintf(json, size,
           "{\"accel\":%u,\"gyro\":%u,\"filter\":%u,\"readMs\":%u,\"printMs\":%u,"
           "\"mode\":%u,\"keyAngle\":%u,\"mouseSpeed\":%u,\"deadZone\":%u,"
           "\"invertX\":%d,\"invertY\":%d,\"keySpeed\":%u}",
           cfg.accelRange, cfg.gyroRange, cfg.filter, cfg.readMs, cfg.printMs,
           cfg.mode, cfg.keyAngle, cfg.mouseSpeed, cfg.deadZone, cfg.invertX, cfg.invertY,
           cfg.keySpeed);
}

void handleGetConfig() {
  char json[256];
  configJson(json, sizeof(json));
  server.send(200, "application/json", json);
}

void handleSetConfig() {
  long accel = server.arg("accel").toInt();
  long gyro = server.arg("gyro").toInt();
  long filter = server.arg("filter").toInt();
  long readMs = server.arg("readMs").toInt();
  long printMs = server.arg("printMs").toInt();
  long mode = server.arg("mode").toInt();
  long keyAngle = server.arg("keyAngle").toInt();
  long mouseSpeed = server.arg("mouseSpeed").toInt();
  long deadZone = server.arg("deadZone").toInt();
  long keySpeed = server.arg("keySpeed").toInt();

  if (accel < 0 || accel > 3 || gyro < 0 || gyro > 3 || filter < 0 || filter > 6 ||
      readMs < 5 || readMs > 5000 || printMs < 0 || printMs > 60000 ||
      mode < 0 || mode > 2 || keyAngle < 3 || keyAngle > 60 ||
      mouseSpeed < 1 || mouseSpeed > 30 || deadZone < 0 || deadZone > 30 ||
      keySpeed < 10 || keySpeed > 100) {
    server.send(400, "text/plain", "Valores fuera de rango");
    return;
  }

  cfg.accelRange = accel;
  cfg.gyroRange = gyro;
  cfg.filter = filter;
  cfg.readMs = readMs;
  cfg.printMs = printMs;
  cfg.keyAngle = keyAngle;
  cfg.mouseSpeed = mouseSpeed;
  cfg.deadZone = deadZone;
  cfg.keySpeed = keySpeed;
  cfg.invertX = server.hasArg("invertX");
  cfg.invertY = server.hasArg("invertY");
  setMode(mode);  // también guarda los ajustes
  if (mpuOk) mpuApplySettings();

  Serial.println("Ajustes guardados");
  server.send(200, "text/plain", "OK");
}

void handleCalibrate() {
  if (!mpuOk) {
    server.send(503, "text/plain", "MPU6050 no detectado");
    return;
  }
  calibrate();
  server.send(200, "text/plain", "OK");
}

// ---------------- Órdenes por el puerto serial (las usa el juego) ----------------
// GET                      -> responde CFG:{...}
// SET clave=valor ...      -> cambia ajustes, los guarda y responde CFG:{...}
// CAL                      -> toma la posición actual como centro
void printConfigLine() {
  char json[256];
  configJson(json, sizeof(json));
  Serial.printf("CFG:%s\n", json);
}

void applySerialSetting(const String &key, long v) {
  if (key == "mode") setMode(constrain(v, 0, 2));
  else if (key == "keyAngle") cfg.keyAngle = constrain(v, 3, 60);
  else if (key == "keySpeed") cfg.keySpeed = constrain(v, 10, 100);
  else if (key == "mouseSpeed") cfg.mouseSpeed = constrain(v, 1, 30);
  else if (key == "deadZone") cfg.deadZone = constrain(v, 0, 30);
  else if (key == "invertX") cfg.invertX = v != 0;
  else if (key == "invertY") cfg.invertY = v != 0;
  else if (key == "printMs") cfg.printMs = constrain(v, 0, 60000);
  else if (key == "readMs") cfg.readMs = constrain(v, 5, 5000);
}

void handleSerialCommand(String line) {
  line.trim();
  if (line == "GET") {
    printConfigLine();
  } else if (line == "CAL") {
    if (mpuOk) calibrate();
    printConfigLine();
  } else if (line.startsWith("SET ")) {
    line = line.substring(4);
    while (line.length() > 0) {
      int sp = line.indexOf(' ');
      String pair = sp < 0 ? line : line.substring(0, sp);
      line = sp < 0 ? "" : line.substring(sp + 1);
      int eq = pair.indexOf('=');
      if (eq > 0) applySerialSetting(pair.substring(0, eq), pair.substring(eq + 1).toInt());
    }
    saveSettings();
    printConfigLine();
  }
}

void readSerialCommands() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (buf.length() > 0) handleSerialCommand(buf);
      buf = "";
    } else if (buf.length() < 200) {
      buf += c;
    }
  }
}

// ---------------- Programa principal ----------------
void setup() {
  // Mantener apagado el LED de la placa (GPIO48)
  pinMode(48, OUTPUT);
  digitalWrite(48, LOW);
  pinMode(BTN_PIN, INPUT_PULLUP);

  loadSettings();

  // USB: teclado + mouse + puerto serial
  USB.productName("Control MPU6050");
  USB.manufacturerName("ESP32-S3");
  Keyboard.begin();
  Mouse.begin();
  USB.begin();

  Serial.begin(115200);
  delay(1000);

  Wire.begin(I2C_SDA, I2C_SCL, 400000);
  mpuOk = mpuInit();
  Serial.println(mpuOk ? "MPU6050 detectado" : "MPU6050 NO detectado");

  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(apIP, apGateway, apMask);
  bool ok = WiFi.softAP(AP_SSID, AP_PASS);
  WiFi.setTxPower(WIFI_POWER_8_5dBm);  // la antena del Super Mini funciona mejor así

  Serial.println(ok ? "AP iniciado" : "Error al iniciar el AP");
  Serial.printf("SSID: %s\n", AP_SSID);
  Serial.print("Configuración en: http://");
  Serial.println(WiFi.softAPIP());
  Serial.printf("Modo: %s\n", MODE_NAMES[cfg.mode]);

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.on("/config", HTTP_GET, handleGetConfig);
  server.on("/config", HTTP_POST, handleSetConfig);
  server.on("/calibrate", HTTP_POST, handleCalibrate);
  server.onNotFound([]() { server.send(404, "text/plain", "No encontrado"); });
  server.begin();
}

void loop() {
  server.handleClient();
  updateButton();
  readSerialCommands();

  // Leer el sensor y actualizar el control
  static unsigned long lastRead = 0;
  unsigned long now = millis();
  if (now - lastRead >= cfg.readMs) {
    float dt = (now - lastRead) / 1000.0f;
    if (dt > 0.2f) dt = 0.2f;
    lastRead = now;

    if (!mpuOk) {
      static unsigned long lastRetry = 0;
      if (now - lastRetry > 2000) {  // reintentar si se conecta después
        lastRetry = now;
        mpuOk = mpuInit();
      }
    } else if (mpuRead()) {
      updateAngles(dt);
      // Al arrancar: esperar 1 s a que la lectura se estabilice y tomar esa posición como centro
      static unsigned long firstOk = 0;
      if (!calibrated) {
        if (firstOk == 0) firstOk = now;
        if (now - firstOk > 1000) {
          calibrate();
          calibrated = true;
        }
      }
      updateHid(dt);
    } else {
      mpuOk = false;
      releaseAll();  // no dejar teclas "pegadas" si se desconecta el sensor
    }
  }

  // Enviar las lecturas por el puerto serial
  static unsigned long lastPrint = 0;
  if (cfg.printMs > 0 && millis() - lastPrint >= cfg.printMs) {
    lastPrint = millis();
    if (mpuOk) {
      Serial.printf("Incl X:%6.1f Y:%6.1f | Acel(g) X:%5.2f Y:%5.2f Z:%5.2f | Giro X:%6.1f Y:%6.1f Z:%6.1f | %s\n",
                    roll, pitch, ax, ay, az, gx, gy, gz, MODE_NAMES[cfg.mode]);
    } else {
      static unsigned long lastWarn = 0;
      if (millis() - lastWarn > 2000) {
        lastWarn = millis();
        Serial.println("MPU6050 no detectado: revisa las conexiones");
      }
    }
  }
}
