# 🔍 Diagnóstico: Gráficas mostrando valores constantes

## Problema Reportado
- Nivel siempre aparece en 100%
- Presión siempre en 0
- Flujo siempre en 0

## ✅ Soluciones Implementadas

### 1. **Panel de Debug Agregado**
Ahora verás un panel amarillo que muestra los datos crudos recibidos:
- ⏱️ Tiempo en milisegundos
- 📊 Valor exacto de nivel
- 💧 Valor exacto de flujo
- 📈 Valor exacto de presión
- Todos los demás valores

**Esto te ayudará a ver exactamente qué está recibiendo el dashboard.**

### 2. **Valores Raw en las Tarjetas**
Cada tarjeta ahora muestra:
- El valor formateado (grande)
- El valor "Raw" (pequeño, debajo)

Compara estos valores para ver si el problema es en el Arduino o en el parseo.

### 3. **Gráficas Mejoradas**
- ✅ **Dominio dinámico** en Flujo y Presión (ahora usa `domain={['auto', 'auto']}`)
- ✅ **Etiquetas en ejes** para distinguir izquierdo (L/min) y derecho (kPa)
- ✅ **Valores actuales** mostrados en el encabezado de cada gráfica
- ✅ **Tooltips mejorados** con formato correcto
- ✅ **Colores en ejes** que coinciden con las líneas

### 4. **Logging Mejorado**
- Cada 50 muestras, se imprime en la consola del navegador (F12) los datos recibidos
- Warnings si las líneas DATA están incompletas
- Validación mejorada con parseFloat/parseInt

### 5. **Simulador de Arduino** 🧪
**NUEVA CARACTERÍSTICA**: Puedes probar sin Arduino real!

1. Activa el **switch "Modo Simulación"**
2. Aparecerá un panel azul con botones
3. Haz clic en **▶️ Iniciar Simulación**
4. Las gráficas comenzarán a moverse con datos sintéticos
5. Usa **💧 +Agua** y **💧 -Agua** para simular cambios de nivel

**Esto te permite verificar que las gráficas funcionen correctamente.**

---

## 🔎 Cómo Diagnosticar el Problema

### **Paso 1: Verifica con el Simulador**
1. Activa **Modo Simulación**
2. Inicia la simulación
3. **¿Las gráficas se mueven?**
   - ✅ **SÍ** → Las gráficas funcionan bien, el problema está en el Arduino
   - ❌ **NO** → Revisa la consola del navegador (F12) por errores

### **Paso 2: Verifica los Datos del Arduino**
1. Desactiva el simulador
2. Conecta el Arduino
3. Mira el **Panel de Debug amarillo**
4. Observa los valores que aparecen

#### **Escenario A: El panel no aparece**
- El Arduino no está enviando líneas DATA
- Verifica que el sketch esté corriendo
- Abre el Monitor Serial de Arduino IDE y verifica qué envía

#### **Escenario B: Los valores son siempre iguales**
- El Arduino está enviando valores constantes
- Problema en el código del Arduino
- Revisa los sensores (ultrasonido, caudalímetro, sensor de presión)

#### **Escenario C: Los valores cambian pero las gráficas no**
- Mira la consola del navegador (F12)
- Busca errores JavaScript
- Verifica que el formato sea exacto: `DATA,ms,nivel,flow,kpa,pwm,alarm,running,manual`

### **Paso 3: Verifica el Formato de Datos**

El Arduino DEBE enviar líneas así:
```
DATA,12500,75.3,2.45,15.8,180,0,1,0
```

**Formato correcto:**
```
DATA,<tiempo_ms>,<nivel_%>,<flujo_lpm>,<presion_kpa>,<pwm>,<alarm>,<running>,<manual>
```

**Errores comunes:**
❌ `DATA,12500,75.3,2.45` → Faltan campos
❌ `DATOS,12500,75.3,...` → Palabra clave incorrecta
❌ `DATA 12500 75.3 ...` → Faltan las comas
❌ `DATA,12500,75,3,2,45,...` → Coma en lugar de punto decimal

### **Paso 4: Revisa la Consola del Navegador**
1. Presiona **F12** en el navegador
2. Ve a la pestaña **Console**
3. Busca mensajes como:
   - `Datos recibidos: {t: 12500, nivel: 75.3, ...}` ✅ Bien
   - `Línea DATA incompleta: ...` ❌ Formato incorrecto
   - Errores rojos ❌ Problemas en el código

### **Paso 5: Verifica los Sensores del Arduino**

Si el simulador funciona pero el Arduino no:

#### **Sensor de Nivel (Ultrasónico):**
```cpp
// En el sketch Arduino, verifica:
long duration = pulseIn(TRIG_PIN, HIGH, 30000);
if (duration == 0) {
  // Sensor no responde
  Serial.println("ERROR,ULTRASONIDO_NO_RESPONDE");
}
```

#### **Sensor de Flujo (Caudalímetro):**
```cpp
// Verifica que el contador de pulsos funcione
volatile int flowPulseCount = 0;

void flowPulseCounter() {
  flowPulseCount++;
}

void setup() {
  attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowPulseCounter, RISING);
}
```

#### **Sensor de Presión:**
```cpp
// Si simulas presión:
float pressure = flowRate * K_PRESSURE;
// K_PRESSURE debe ser > 0
```

---

## 🧪 Prueba con el Simulador

### **Qué hace el simulador:**
1. Genera nivel que empieza en 50%
2. Simula PWM que intenta mantener nivel en 75%
3. Flujo proporcional al PWM (0-3.5 L/min)
4. Presión proporcional al flujo (aprox 6.5x)
5. Alarma si nivel > 90%
6. Nivel se vacía lentamente si no hay bombeo

### **Botones del simulador:**
- **▶️ Iniciar**: Empieza a generar datos cada 200ms
- **⏹️ Detener**: Para la simulación
- **🔄 Resetear**: Vuelve todo a cero
- **💧 +Agua**: Sube el nivel +10%
- **💧 -Agua**: Baja el nivel -10%

### **Prueba esto:**
1. Inicia simulación
2. Espera 10 segundos (las gráficas deben dibujarse)
3. Haz clic en **💧 +Agua** varias veces
4. Observa cómo:
   - La gráfica de **Nivel** sube (línea verde)
   - La gráfica de **PWM** baja (el PID reduce potencia)
   - La gráfica de **Flujo** cambia (línea azul)
   - La gráfica de **Presión** cambia (línea naranja punteada)

---

## 📊 Interpretación de las Gráficas

### **Gráfica de Nivel (0-100%)**
- Línea verde
- Debe moverse entre 0 y 100
- En modo AUTO, el PID intenta mantenerlo en el setpoint

### **Gráfica de Flujo y Presión**
- **Línea azul (izquierda)**: Flujo en L/min
- **Línea naranja punteada (derecha)**: Presión en kPa
- Ahora usa **escala automática** (domain: auto)
- Si los valores son pequeños, la escala se ajustará automáticamente

### **Gráfica de PWM (0-255)**
- Línea violeta
- 0 = Bomba apagada
- 255 = Bomba a máxima potencia
- En modo AUTO, varía según el PID
- En modo MANUAL, va a 255 fijo

---

## 🔧 Checklist de Diagnóstico

### **En el Dashboard:**
- [ ] El panel de debug aparece cuando hay conexión
- [ ] Los valores "Raw" en las tarjetas cambian
- [ ] El contador de registros aumenta
- [ ] Las gráficas tienen puntos (no están vacías)
- [ ] El simulador funciona correctamente

### **En la Consola del Navegador (F12):**
- [ ] Aparecen logs "Datos recibidos: ..." cada cierto tiempo
- [ ] No hay errores rojos
- [ ] No aparecen warnings de "Línea DATA incompleta"

### **En el Arduino:**
- [ ] El LED de TX parpadea (está enviando datos)
- [ ] En el Monitor Serial se ven líneas DATA
- [ ] Las líneas tienen 9 campos separados por comas
- [ ] Los valores cambian con el tiempo

### **En los Sensores:**
- [ ] El ultrasonido responde (duration > 0)
- [ ] El caudalímetro cuenta pulsos (flowPulseCount > 0)
- [ ] La bomba se activa (LED/relay funciona)

---

## 💡 Soluciones Rápidas

### **Si nivel siempre 100%:**
```cpp
// En Arduino, imprime el valor raw:
Serial.print("DEBUG,nivel_raw=");
Serial.println(nivelPct);

// Verifica el cálculo:
// ¿Está correcta la altura del tanque?
// ¿Está correcta la distancia del sensor?
```

### **Si flujo siempre 0:**
```cpp
// Verifica que los pulsos se cuenten:
Serial.print("DEBUG,pulsos=");
Serial.println(flowPulseCount);

// Verifica la interrupción:
attachInterrupt(digitalPinToInterrupt(FLOW_PIN), flowPulseCounter, RISING);
```

### **Si presión siempre 0:**
```cpp
// Si calculas presión del flujo:
float pressure = flowRate * K_PRESSURE;

// Verifica que K_PRESSURE > 0
// O si usas sensor analógico:
int raw = analogRead(PRESSURE_PIN);
Serial.print("DEBUG,pressure_raw=");
Serial.println(raw);
```

---

## 📝 Siguiente Paso

1. **Activa el simulador** y verifica que las gráficas funcionen
2. **Si funciona el simulador**: El problema está en el Arduino
3. **Si no funciona el simulador**: Revisa la consola del navegador por errores
4. **Usa el panel de debug** para ver los datos exactos que recibe
5. **Compara** con lo que el Arduino envía en Monitor Serial

---

## 🆘 Si Nada Funciona

Abre la consola del navegador (F12) y manda un screenshot de:
1. La pestaña **Console** (mensajes y errores)
2. El **Panel de Debug** amarillo
3. Lo que aparece en el **Monitor Serial** del Arduino

Con esa info podré ayudarte mejor! 🚀
