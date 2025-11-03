#include <PID_v1.h>   // Arduino PID Library
#include <SD.h>
#include <SPI.h>

// ------------------ Pines ------------------
const uint8_t PIN_TRIG = 33, PIN_ECHO = 32;
const uint8_t PIN_FLOW = 2;             // INT0
const uint8_t PIN_PUMP_PWM = 47;        // MOSFET a bomba (en Mega NO es PWM real)
const uint8_t PIN_BUZZ = 48, PIN_LED = 11;
const uint8_t PIN_PRESS = A0;
const uint8_t PIN_SD_CS = 53;           // Chip Select SD (Mega: usualmente 53). OJO con el módulo.

// ------------------ Parámetros físico-geométricos ------------------
const float TANK_HEIGHT_CM = 15.0;      // AJUSTAR a tu tanque
const float SENSOR_OFFSET_CM = 8.0;     // AJUSTAR (offset del sensor cuando está al 100%)
  
// ---- Variables para flujo ----
volatile uint32_t flow_pulses = 0;
volatile unsigned long lastPulseUs = 0;     // anti-rebote/EMI en ISR
const unsigned long MIN_PULSE_US = 1500;    // ignora pulsos más rápidos que ~1.5 ms
const float PULSES_PER_LITER = 450.0;       // CALIBRAR
unsigned long lastFlowMs = 0;
float flow_lpm = 0.0;

// Muestreo y filtros de caudal
const unsigned long FLOW_SAMPLE_MS = 1000;  // periodo de muestreo de caudal
const float MAX_VALID_LPM = 12.0;           // tope razonable; picos por ruido se descartan

// Buffer circular para suavizar lecturas de flujo
#define FLOW_BUFFER_SIZE 5
float flowBuffer[FLOW_BUFFER_SIZE];
uint8_t flowBufferIndex = 0;
bool flowBufferFull = false;

// ------------------ SD Card ------------------
bool sdAvailable = false;
String currentLogFile = "";
unsigned long lastSDWrite = 0;
const unsigned long SD_WRITE_INTERVAL = 5000; // Escribir cada 5 segundos

File logFile;                     // Mantenemos el archivo abierto
int escritos_desde_flush = 0;     // Para flush periódico

// ------------------ PID ------------------
double sp_level_pct = 80.0; // setpoint %
double pv_level_pct = 0.0;  // proceso: % nivel
double cv_pwm = 245.0;      // control output 0-255

double Kp=1.2, Ki=0.4, Kd=0.05; // arranque; luego tunear
PID pid(&pv_level_pct, &cv_pwm, &sp_level_pct, Kp, Ki, Kd, DIRECT);

bool running = false;
bool manualMode = false;  // modo manual

// ------------------ Variables para alarma ------------------
unsigned long alarmStart = 0;
bool alarmActive = false;

// ------------------ Utilitarios ------------------
void isr_flow() {
  // Antirrebote/EMI por tiempo mínimo entre pulsos
  unsigned long t = micros();
  if (t - lastPulseUs > MIN_PULSE_US) {
    flow_pulses++;
    lastPulseUs = t;
  }
}

long echoMicroseconds() {
  digitalWrite(PIN_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  return pulseIn(PIN_ECHO, HIGH, 30000UL); // 30ms timeout (~5m)
}

float read_level_percent() {
  const uint8_t N = 7;
  const uint8_t MAX_TRIES = 25;

  // valor anterior y timestamp para limitar pendiente por tiempo
  static float prev = NAN;                 // NAN para detectar "primera vez"
  static unsigned long lastUpdate = 0;

  float v[N];
  uint8_t k = 0;

  // Recolectar hasta N lecturas válidas
  for (uint8_t tries = 0; tries < MAX_TRIES && k < N; tries++) {
    long us = echoMicroseconds();
    if (us == 0) continue;
    float dist = us / 58.0f;

    // Acepta desde muy lleno hasta bastante vacío (offset ±1 cm y +30 cm extra)
    if (dist < SENSOR_OFFSET_CM - 1 ||
        dist > SENSOR_OFFSET_CM + TANK_HEIGHT_CM + 30) continue;

    float level_cm = TANK_HEIGHT_CM - (dist - SENSOR_OFFSET_CM);
    float pct = (100.0f * level_cm) / TANK_HEIGHT_CM;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;

    v[k++] = pct;
    delay(5);
  }

  // Si no hay suficientes lecturas válidas → mantener el último valor
  if (k < 3) {
    return isnan(prev) ? 0.0f : prev;   // en el arranque, si aún no hay valor previo, devuelve 0
  }

  // Ordenar v[0..k-1]
  for (uint8_t i = 0; i < k - 1; i++)
    for (uint8_t j = i + 1; j < k; j++)
      if (v[j] < v[i]) { float t = v[i]; v[i] = v[j]; v[j] = t; }

  // Media recortada (quitamos extremos) para resistir espuma/olas
  uint8_t drop = (k >= 7) ? 2 : 1;     // descarta 1 o 2 de cada extremo según cuántas haya
  float sum = 0; uint8_t n = 0;
  for (uint8_t i = drop; i < k - drop; i++) { sum += v[i]; n++; }
  float filt = sum / n;

  unsigned long now = millis();

  // Primera lectura buena → sembrar sin limitador
  if (isnan(prev)) {
    prev = filt;
    lastUpdate = now;
    return prev;
  }

  // Limitador de pendiente por tiempo (independiente de la frecuencia de llamada)
  float dt = (now - lastUpdate) / 1000.0f;           // segundos
  if (dt <= 0) dt = 0.001f;

  const float MAX_SLOPE = 5.0f;                      // % por segundo (AJUSTA: 3–8 %/s)
  float max_step = MAX_SLOPE * dt;

  float delta = filt - prev;
  if (delta >  max_step) delta =  max_step;
  if (delta < -max_step) delta = -max_step;

  prev += delta;
  lastUpdate = now;
  return prev;
}


float calculateSmoothedFlow() {
  // Promedio del buffer para suavizar
  float sum = 0;
  uint8_t count = flowBufferFull ? FLOW_BUFFER_SIZE : flowBufferIndex;
  if (count == 0) return 0.0;
  for (uint8_t i = 0; i < count; i++) sum += flowBuffer[i];
  return sum / count;
}

float read_pressure_kpa() {
  // Simulación: presión ~ k * caudal
  const float k = 5.0; // 5 kPa por L/min (ejemplo)
  return flow_lpm * k;
}

// ------------- SD: helpers -------------
static void sd_prepare_bus() {
  // En el MEGA, el pin 53 (SS) debe ser salida siempre; y CS de SD en HIGH antes del begin
  pinMode(53, OUTPUT);                 // SS del Mega
  pinMode(PIN_SD_CS, OUTPUT);
  digitalWrite(PIN_SD_CS, HIGH);       // deseleccionar SD
}

static bool sd_begin_safe() {
  sd_prepare_bus();
  return SD.begin(PIN_SD_CS);
}

static bool open_new_logfile() {
  // Crear nombre de archivo único
  int fileNum = 0;
  do {
    currentLogFile = "LOG_" + String(fileNum) + ".csv";
    fileNum++;
  } while (SD.exists(currentLogFile) && fileNum < 1000);

  logFile = SD.open(currentLogFile, FILE_WRITE);
  if (!logFile) return false;

  logFile.println(F("Time(ms),Level(%),Flow(L/min),Pressure(kPa),PWM,Alarm,Running,Manual"));
  logFile.flush();
  escritos_desde_flush = 0;
  return true;
}

void initSD() {
  Serial.print(F("Iniciando SD... "));
  if (!sd_begin_safe()) {
    Serial.println(F("ERROR"));
    sdAvailable = false;
    return;
  }
  Serial.println(F("OK"));
  sdAvailable = true;

  if (!open_new_logfile()) {
    Serial.println(F("Error al crear archivo"));
    sdAvailable = false;
    return;
  }
  Serial.print(F("Archivo creado: "));
  Serial.println(currentLogFile);
}

bool writeToSD_safe(unsigned long timestamp, float level, float flow, float pressure, int pwm, bool alarm, bool run, bool manual) {
  if (!sdAvailable) return false;

  if (!logFile) {
    logFile = SD.open(currentLogFile, FILE_WRITE);
    if (!logFile) {
      Serial.println(F("Error al escribir en SD (open)"));
      return false;
    }
  }

  bool ok = true;
  ok &= (logFile.print(timestamp) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(level, 1) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(flow, 2) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(pressure, 1) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(pwm) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(alarm ? 1 : 0) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.print(run ? 1 : 0) > 0);
  ok &= (logFile.print(',') > 0);
  ok &= (logFile.println(manual ? 1 : 0) > 0);

  if (!ok) {
    Serial.println(F("Error al escribir en SD (print)"));
    logFile.flush();
    logFile.close();
    delay(20);
    logFile = SD.open(currentLogFile, FILE_WRITE);
    return false;
  }

  // Flush periódico (no cada vez)
  if (++escritos_desde_flush >= 10) {
    logFile.flush();
    escritos_desde_flush = 0;
  }

  Serial.println(F("LOG,OK"));
  return true;
}

// ------------------ setup & loop ------------------
void setup() {
  Serial.begin(9600);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_PUMP_PWM, OUTPUT);
  pinMode(PIN_BUZZ, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_FLOW, INPUT_PULLUP);

  attachInterrupt(digitalPinToInterrupt(PIN_FLOW), isr_flow, FALLING);

  pid.SetMode(AUTOMATIC);
  pid.SetOutputLimits(0, 255);
  pid.SetSampleTime(200); // ms

  lastFlowMs = millis();

  // Inicializar buffer flujo
  for (uint8_t i = 0; i < FLOW_BUFFER_SIZE; i++) flowBuffer[i] = 0.0;
  flowBufferIndex = 0;
  flowBufferFull = false;

  // Inicializar SD
  initSD();

  Serial.println(F("OK,BOOT"));
}

void loop() {
  // ---- Medidas ----
  pv_level_pct = read_level_percent();
  float press_kpa = read_pressure_kpa();

  // Flujo cada FLOW_SAMPLE_MS (lectura SIEMPRE, aunque la bomba esté apagada)
  unsigned long now = millis();
  if (now - lastFlowMs >= FLOW_SAMPLE_MS) {
    noInterrupts();
    uint32_t totalPulses = flow_pulses;
    flow_pulses = 0;
    interrupts();

    float deltaTime_min = (now - lastFlowMs) / 60000.0; // minutos
    if (deltaTime_min <= 0) deltaTime_min = FLOW_SAMPLE_MS / 60000.0;

    float instantFlow = (float)totalPulses / PULSES_PER_LITER / deltaTime_min;

    // Manejo de outliers: si sale negativo o por encima del tope, conserva el valor anterior
    if (instantFlow < 0.0f || instantFlow > MAX_VALID_LPM) {
      instantFlow = flow_lpm;
    }

    // Buffer circular
    flowBuffer[flowBufferIndex] = instantFlow;
    flowBufferIndex = (flowBufferIndex + 1) % FLOW_BUFFER_SIZE;
    if (flowBufferIndex == 0) flowBufferFull = true;

    // Suavizado
    flow_lpm = calculateSmoothedFlow();

    lastFlowMs = now;
  }

  // ---- Alarma nivel alto (>80%) si NO está en manual ----
  bool highLevelAlarm = (pv_level_pct > 80.0) && !manualMode;

  if (highLevelAlarm && !alarmActive) {
    alarmActive = true;
    alarmStart = now;
    digitalWrite(PIN_BUZZ, HIGH);
    digitalWrite(PIN_LED, HIGH);
    // running pasa a false en el bloque de control
    Serial.println(F("ALARM,HIGH_LEVEL"));
  }

  // Apagar buzzer luego de 5 s (mantener bomba apagada)
  if (alarmActive && (now - alarmStart >= 5000)) {
    digitalWrite(PIN_BUZZ, LOW);
    digitalWrite(PIN_LED, LOW);
    Serial.println(F("ALARM,BUZZER_OFF"));
  }

  // Reset de alarma cuando baje a <75%
  if (alarmActive && (pv_level_pct < 75.0)) {
    alarmActive = false;
    digitalWrite(PIN_BUZZ, LOW);
    digitalWrite(PIN_LED, LOW);
    Serial.println(F("ALARM,RESET"));
    // running queda false hasta comando START
  }

  // ---- Control de bomba (guardar PWM REAL aplicado) ----
  int pwm_cmd = 0;
  if (manualMode && running) {
    pwm_cmd = 255; // manual full
  } else if (running && !alarmActive) {
    pid.Compute();
    pwm_cmd = (int)cv_pwm;
  } else {
    pwm_cmd = 0;   // apagada
  }

  // Si hay alarma, asegura detener y marcar running=false
  if (alarmActive) running = false;

  analogWrite(PIN_PUMP_PWM, pwm_cmd);

  // ---- Escritura a SD Card ----
  if (sdAvailable && (now - lastSDWrite >= SD_WRITE_INTERVAL)) {
    if (!writeToSD_safe(now, pv_level_pct, flow_lpm, press_kpa, pwm_cmd, alarmActive, running, manualMode)) {
      // Recuperación agresiva si falla
      Serial.println(F("SD,RECOVER"));
      if (logFile) {
        logFile.flush();
        logFile.close();
      }
      delay(50);
      initSD();
    }
    lastSDWrite = now;
  }

  // ---- Telemetría ----
  static unsigned long lastTx=0;
  if (now - lastTx >= 200) {
    Serial.print(F("DATA,"));
    Serial.print(now);
    Serial.print(F(",")); Serial.print(pv_level_pct, 1);
    Serial.print(F(",")); Serial.print(flow_lpm, 2);
    Serial.print(F(",")); Serial.print(press_kpa, 1);
    Serial.print(F(",")); Serial.print(pwm_cmd);              // PWM realmente aplicado
    Serial.print(F(",")); Serial.print(alarmActive ? 1 : 0);
    Serial.print(F(",")); Serial.print(running ? 1 : 0);
    Serial.print(F(",")); Serial.println(manualMode ? 1 : 0);
    lastTx = now;
  }

  // ---- Comandos por Serial ----
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n'); line.trim();

    if (line == "START") {
      if (!alarmActive) {
        running = true;
        manualMode = false;
        Serial.println("OK,START");
      } else {
        Serial.println("ERROR,ALARM_ACTIVE");
      }
    }
    else if (line == "START-EXTRA") {
      // Modo manual: ignora alarmas y nivel
      running = true;
      manualMode = true;
      if (alarmActive) {
        digitalWrite(PIN_BUZZ, LOW);
        digitalWrite(PIN_LED, LOW);
      }
      Serial.println("OK,START-EXTRA");
    }
    else if (line == "STOP") {
      running = false;
      manualMode = false;
      analogWrite(PIN_PUMP_PWM, 0);
      Serial.println("OK,STOP");
    }
    else if (line == "STOP-EXTRA") {
      running = false;
      manualMode = false;
      analogWrite(PIN_PUMP_PWM, 0);
      Serial.println("OK,STOP-EXTRA");
    }
    else if (line == "RESET") {
      alarmActive = false;
      digitalWrite(PIN_BUZZ, LOW);
      digitalWrite(PIN_LED, LOW);
      Serial.println("OK,RESET");
    }
    else if (line == "SD-STATUS") {
      Serial.print(F("SD,"));
      Serial.print(sdAvailable ? F("OK,") : F("ERROR,"));
      Serial.println(currentLogFile);
    }
    else if (line == "SD-NEWFILE") {
      if (sdAvailable) {
        if (logFile) { logFile.flush(); logFile.close(); }
        initSD();
        Serial.println(F("OK,NEWFILE"));
      } else {
        Serial.println(F("ERROR,SD_NOT_AVAILABLE"));
      }
    }
    else if (line.startsWith("SP,")) { sp_level_pct = line.substring(3).toFloat(); Serial.println("OK,SP"); }
    else if (line.startsWith("KP,")) { Kp = line.substring(3).toFloat(); pid.SetTunings(Kp,Ki,Kd); Serial.println("OK,KP"); }
    else if (line.startsWith("KI,")) { Ki = line.substring(3).toFloat(); pid.SetTunings(Kp,Ki,Kd); Serial.println("OK,KI"); }
    else if (line.startsWith("KD,")) { Kd = line.substring(3).toFloat(); pid.SetTunings(Kp,Ki,Kd); Serial.println("OK,KD"); }
  }
}
