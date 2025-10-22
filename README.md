
# README — Panel “PID Tanque Piloto” (Web Serial + Arduino)

## 1) ¿Qué es y qué requiere?

Este panel es una SPA en React que se conecta **por Web Serial** a tu Arduino para:

* Mostrar telemetría en tiempo real (nivel %, caudal L/min, presión kPa, PWM).
* Enviar **comandos** (START/STOP, modo manual, setpoint y tunings PID).
* Crear y rotar archivos de log en SD desde el propio sketch.

**Requisitos del navegador:**

* Chrome/Edge con ​**Web Serial API**​.
* Página servida bajo **https://** o **[http://localhost](http://localhost/)** (por seguridad del API). ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API?utm_source=chatgpt.com "Web Serial API - MDN - Mozilla"))

**Librerías en Arduino:**

* `PID_v1.h` (Brett Beauregard). ([GitHub](https://github.com/br3ttb/Arduino-PID-Library?utm_source=chatgpt.com "br3ttb/Arduino-PID-Library"))
* `SD.h` / `SPI.h` para la tarjeta SD. ([Arduino](https://www.arduino.cc/en/Reference/SD?utm_source=chatgpt.com "SD | Arduino Documentation"))

---

## 2) Cómo ejecutar el panel

1. **Build/serve** tu app (Next/Vite/CRA). Sirve en `https://` o `http://localhost`.
2. Conecta tu Arduino por USB y sube el sketch (baud ​**9600**​).
3. Abre la página del panel y pulsa **Conectar** → el navegador pedirá elegir el ​**puerto serial**​.
4. Si todo va bien, verás:
   * Tarjetas con **Nivel/Flujo/Presión/PWM** en vivo.
   * Gráficos de ​**Nivel**​, ​**Flujo & kPa**​, y **PWM** (Recharts). ([recharts.org](https://recharts.org/?utm_source=chatgpt.com "Recharts"))
   * **Consola** de mensajes del sketch (OK, ALARM, SD, etc.).

**Formato de telemetría esperado (una línea cada 200 ms):**
`DATA,<ms>,<nivel%>,<flow L/min>,<kPa>,<PWM>,<alarm>,<running>,<manual>`
(eso es exactamente lo que emite tu `loop()`).

---

## 3) Vistas y significado

### Estado en vivo (cards superiores)

* ​**Nivel**​: `%` promedio de 5 lecturas ultrasónicas con compensación de offset.
* ​**Flujo**​: L/min (suavizado con buffer circular de 5 muestras).
* ​**Presión**​: kPa (en el sketch la simulas como `k * flow`).
* ​**PWM**​: salida 0–255 que el PID entrega a la bomba.

> Técnicas usadas en el sketch: `pulseIn()` para ultrasonido, `attachInterrupt()` para el caudalímetro, y cálculo de flujo por pulsos/tiempo. ([Arduino Documentation](https://docs.arduino.cc/language-reference/en/functions/advanced-io/pulseIn/?utm_source=chatgpt.com "pulseIn()"))

### Indicadores (RUN/Modo/Alarma)

* ​**Estado**​: `RUNNING`/`STOPPED` (variable `running`).
* ​**Modo**​: `PID (AUTO)` o `MANUAL (EXTRA)` (variable `manualMode`).
* ​**Alarma**​: `ACTIVA/OK`. En alarma alta de nivel:
  * Se apaga la bomba, buzzer/LED on 5 s y se detiene el proceso.
  * Se auto-resetea al bajar de 75 %.

---

## 4) Controles — ¿Qué hace cada botón?

### Bloque “Proceso”

| Botón                    | Comando enviado   | ¿Qué hace en el sketch?                                                                                                               |
| --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **START**           | `START`       | Activa control**PID (AUTO)**si no hay alarma.`running=true`,`manualMode=false`.                                           |
| **STOP**            | `STOP`        | Detiene proceso. PWM a 0,`running=false`,`manualMode=false`.                                                                    |
| **START-EXTRA**     | `START-EXTRA` | ​**Modo manual**​: fuerza la bomba​**a tope (PWM=255)**​, ignora alarma/nivel.`running=true`,`manualMode=true`. |
| **STOP-EXTRA**      | `STOP-EXTRA`  | Sale de manual y detiene (PWM 0).                                                                                                       |
| **Enviar SP**       | `SP,`  | Cambia el setpoint de nivel`%`(ej.`SP,80`).                                                                                     |
| **Limpiar memoria** | —                | Limpia el buffer de datos en el**frontend**(no toca SD).                                                                          |
| **Exportar CSV**    | —                | Descarga CSV con toda la telemetría acumulada en el​**frontend**​.                                                             |

### Bloque “PID (auto)”

| Control                         | Comando                          | Efecto                                                                                                      |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Kp / Ki / Kd + Enviar** | `KP,x`,`KI,x`,`KD,x` | Actualiza tunings en tiempo real:`pid.SetTunings(Kp,Ki,Kd)`. (Actúan cuando no estás en`manual`.) |

> La librería **PID\_v1** permite cambiar tunings y tiene `SetSampleTime(200)` en tu setup; también fija límites de salida 0–255. Son prácticas recomendadas del autor (muestreo regular, anti-windup, ajuste en caliente, dirección adecuada). ([GitHub](https://github.com/br3ttb/Arduino-PID-Library?utm_source=chatgpt.com "br3ttb/Arduino-PID-Library"))

### Bloque “SD / Utilidades”

| Botón                       | Comando          | ¿Qué hace?                                                              |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------- |
| **SD-STATUS**          | `SD-STATUS`  | Responde por serial:`SD,OK,`o`SD,ERROR,`. |
| **SD-NEWFILE**         | `SD-NEWFILE` | Cierra el actual y crea un**nuevo .csv**(cabecera incluida).        |
| **Autoscroll consola** | —               | Activa/desactiva desplazamiento automático de la consola del panel.      |

​**Sobre SD**​: usas `SD.open(..., FILE_WRITE)`, `print/println`, y **`flush()` en cada línea** para asegurar persistencia inmediata (trade-off: más writes). El código también intenta **recuperación agresiva** si falla la escritura. ([Arduino](https://www.arduino.cc/en/Reference/SD?utm_source=chatgpt.com "SD | Arduino Documentation"))

---

## 5) Gráficos

* **Nivel (%)** — eje 0–100.
* **Flujo & Presión** — ejes izq./der. (flujo L/min, kPa).
* **PWM** — eje 0–255.
  Se renderizan con **Recharts** (`LineChart`, `Line`, `Tooltip`, `Legend`, `ResponsiveContainer`). ([recharts.org](https://recharts.org/?p=%2Fen-US%2Fapi%2FLineChart&utm_source=chatgpt.com "LineChart"))

---

## 6) Cómo funciona el sketch (resumen técnico)

1. **Sensores**

* ​**Nivel**​: 5 lecturas con `pulseIn()` y compensación de offset → % saturado [0,100]. ([Arduino Documentation](https://docs.arduino.cc/language-reference/en/functions/advanced-io/pulseIn/?utm_source=chatgpt.com "pulseIn()"))
* ​**Flujo**​: interrupciones en `PIN_FLOW` con `attachInterrupt(digitalPinToInterrupt(PIN_FLOW), isr_flow, RISING)`. Cada \~2.5 s se calcula L/min = `pulsos / PULSES_PER_LITER / Δt(min)`, se limita outliers y se suaviza con buffer circular. ([Arduino Documentation](https://docs.arduino.cc/language-reference/en/functions/external-interrupts/attachInterrupt/?utm_source=chatgpt.com "attachInterrupt()"))
* ​**Presión**​: proporcional a caudal (simulada `k*flow`).

2. **PID (auto)**

* `pid.SetMode(AUTOMATIC); SetOutputLimits(0,255); SetSampleTime(200);`
* ​**Auto**​: si `running` y ​**sin alarma**​, `pid.Compute()` → `analogWrite(PIN_PUMP_PWM, cv_pwm)`.
* ​**Manual (EXTRA)**​: si `running` y `manualMode`, ​**PWM 255 fijo**​.
* Base teórica/estilo de implementación = librería de Brett Beauregard (muestreo fijo, anti-windup, tunings en caliente, etc.). ([GitHub](https://github.com/br3ttb/Arduino-PID-Library?utm_source=chatgpt.com "br3ttb/Arduino-PID-Library"))

3. **Alarmas**

* Alarma por **nivel alto** (> 80 % en AUTO): apaga bomba, buzzer/LED 5 s, y requiere que el nivel baje a < 75 % para resetear.
* `RESET` limpia la alarma manualmente (buzzer/LED off).

4. **Telemetría**

* Cada \~200 ms: `DATA,ms,nivel,flow,kPa,PWM,alarm,running,manual` por `Serial.print`.

5. **SD**

* `initSD()` prepara bus SPI del Mega (pin 53 como salida), hace `SD.begin`, y abre un archivo nuevo con cabecera.
* Escritura periódica cada 5 s; cada línea termina en `flush()` + eco `LOG,OK`. Si falla, se intenta re-abrir/rotar. ([Arduino](https://www.arduino.cc/en/Reference/SD?utm_source=chatgpt.com "SD | Arduino Documentation"))

---

## 7) Flujo de comunicación (Web Serial)

En el front, tras ​**Conectar**​:

* Se abre el puerto a **9600** y se crean streams `TextDecoderStream` / `TextEncoderStream`.
* Se parsean líneas terminadas en `\n`; si inician por `DATA,` van a un buffer temporal y cada 200 ms se consolidan (UI fluida con poco GC).
* Los comandos se envían con `writer.write("COMANDO\n")`.
  API de referencia: `navigator.serial`, streams, y permisos. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/serial?utm_source=chatgpt.com "Navigator: serial property - Web APIs | MDN - Mozilla"))

---

## 8) Comparación con trabajos similares (referencias)

* Tu panel cumple el mismo **rol de front-end de tunning** que el **UI en Processing** que acompañaba a la PID Library (cambiar SP/Kp/Ki/Kd, ver gráficos, encender/apagar PID), solo que ahora 100 % web con Web Serial. ([Arduino Forum](https://forum.arduino.cc/t/processing-front-end-for-the-pid-library/7052?utm_source=chatgpt.com "Processing Front-End for the PID Library"))
* Las prácticas de diseño del PID (muestreo fijo, evitar derivative kick, anti-windup, cambio de tunings on-the-fly, dirección del controlador) provienen de la serie **“Improving the Beginner’s PID”** del autor de la librería. Tu sketch sigue esa filosofía (p. ej., `SetSampleTime`, `SetTunings`, límites de salida). ([brettbeauregard.com](https://brettbeauregard.com/blog/2011/04/improving-the-beginners-pid-introduction/?utm_source=chatgpt.com "Improving the Beginner's PID – Introduction | Project Blog"))
* La canalización por **streams** (decoder/encoder) y el requisito de **contexto seguro (https)** son el enfoque recomendado para Web Serial en Chrome. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API?utm_source=chatgpt.com "Web Serial API - MDN - Mozilla"))

---

## 9) Solución de problemas (checklist rápido)

* **No aparece el puerto** al conectar: usa Chrome/Edge actual y sirve la página en `https://` o `http://localhost`. Revisa permisos del puerto. ([MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API?utm_source=chatgpt.com "Web Serial API - MDN - Mozilla"))
* ​**Se conecta pero no llega DATA**​: confirma **baud 9600** y que el sketch imprima líneas `DATA,...\n` (sin caracteres extra).
* ​**Lag o cortes**​: evita `Serial.print` excesivo aparte de `DATA` y logs importantes; en el front ya estás **agregando en lote** cada 200 ms (bien).
* ​**SD no crea archivo**​: revisa conexiones SPI (Mega → pin 53 como `OUTPUT`), `SD.begin(CS)`, y prueba `SD-NEWFILE`. ([Arduino](https://www.arduino.cc/en/Reference/SD?utm_source=chatgpt.com "SD | Arduino Documentation"))
* ​**PID inestable**​: empieza con Kp moderado, Ki bajo, Kd bajo; aumenta de a poco. Revisa guía del autor/recursos PID. ([Arduino Documentation](https://docs.arduino.cc/libraries/pid/?utm_source=chatgpt.com "PID"))

---

## 10) Tabla rápida de comandos soportados por el sketch

```
START          → PID AUTO (si no hay alarma)
STOP           → Detener (PWM 0)
START-EXTRA    → MANUAL: bomba a 255
STOP-EXTRA     → Salir de manual y detener
RESET          → Apaga buzzer/LED y limpia alarma
SD-STATUS      → Imprime estado SD y archivo actual
SD-NEWFILE     → Cierra y crea nuevo log .csv

SP,<x>         → Setpoint de nivel % (ej. SP,80)
KP,<x> / KI,<x> / KD,<x> → Tunings PID
```

---

## 11) Apéndice — Pines y constantes clave (hardware)

* **Ultrasonido:**`TRIG=33` / `ECHO=32` (ajusta `TANK_HEIGHT_CM` y `SENSOR_OFFSET_CM` a tu tanque).
* **Caudalímetro (INT0):**`PIN_FLOW=2` + `PULSES_PER_LITER` (calibrar).
* **Bomba PWM:**`PIN_PUMP_PWM=10` (MOSFET).
* **Buzzer/LED:**`46 / 11`.
* **Presión (simulada):**`A0`.
* **SD CS:**`53` (MEGA).
* **Muestreo PID:**`200 ms` / **Salida:**`0–255`.


