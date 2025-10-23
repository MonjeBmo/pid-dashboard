# 🧪 Guía de Pruebas - Dashboard PID Tanque Piloto

## ✅ Mejoras Implementadas

### 1. **Gráficas en Tiempo Real**
- ✅ Las gráficas se actualizan automáticamente cada 200ms
- ✅ Se muestran los últimos 500 puntos para mejor rendimiento
- ✅ Colores distintivos para cada variable:
  - 🟢 **Nivel**: Verde (#10b981)
  - 🔵 **Flujo**: Azul (#3b82f6)
  - 🟡 **Presión**: Naranja (#f59e0b)
  - 🟣 **PWM**: Violeta (#8b5cf6)
- ✅ Contador de puntos visible en cada gráfica
- ✅ Tooltips mejorados con fondo oscuro
- ✅ Animaciones desactivadas para fluidez en tiempo real

### 2. **Botones Mejorados**
Todos los botones ahora tienen:
- ✅ Iconos visuales para fácil identificación
- ✅ Efectos de hover con escala (hover:scale-105)
- ✅ Feedback en consola cuando se presionan
- ✅ Colores distintivos según función
- ✅ Estados disabled cuando no hay conexión

#### **Botones de Proceso:**
- ▶️ **START** - Verde brillante (bg-emerald-600)
- ⏹️ **STOP** - Gris con hover rojo
- 🛠️ **START-EXTRA** - Ámbar (bg-amber-600) - Modo Manual
- 🔧 **STOP-EXTRA** - Gris con hover naranja

#### **Botones de Control:**
- 🎯 **Enviar SP** - Actualiza setpoint
- 🗑️ **Limpiar memoria** - Con confirmación si hay datos
- 📥 **Exportar CSV** - Solo activo si hay datos

#### **Botones PID:**
- ✓ **Enviar Kp/Ki/Kd** - Actualiza parámetros con feedback

#### **Botones SD:**
- 📋 **SD-STATUS** - Consulta estado de tarjeta SD
- 📝 **SD-NEWFILE** - Crea nuevo archivo de log

### 3. **Exportar CSV Mejorado**
- ✅ Validación: no exporta si no hay datos
- ✅ Nombre de archivo con timestamp: `telemetria_YYYY-MM-DDTHH-MM-SS.csv`
- ✅ Mensaje de confirmación en consola
- ✅ Manejo de errores con alertas
- ✅ Formato UTF-8 para compatibilidad
- ✅ Botón deshabilitado cuando no hay datos

### 4. **Indicadores de Conexión**
- ✅ Punto verde pulsante cuando está conectado
- ✅ Mensaje "Conectado - Recibiendo datos en tiempo real"
- ✅ Botones con iconos 🔌 y ❌

### 5. **Consola Mejorada**
- ✅ Mensajes con emojis para fácil lectura
- ✅ Timestamp en cada mensaje
- ✅ Feedback de todos los comandos enviados
- ✅ Autoscroll opcional
- ✅ Límite de 300 mensajes

---

## 🔬 Cómo Probar el Sistema

### **Paso 1: Conexión**
1. Abre el navegador en `http://localhost:5173/`
2. Conecta el Arduino por USB
3. Haz clic en **🔌 Conectar**
4. Selecciona el puerto serial de tu Arduino
5. Verifica que aparezca el punto verde pulsante

### **Paso 2: Verificar Recepción de Datos**
1. Observa las **tarjetas superiores** (Nivel, Flujo, Presión, PWM)
2. Los valores deben actualizarse en tiempo real
3. Verifica que los **indicadores de estado** reflejen:
   - Estado: RUNNING/STOPPED
   - Modo: PID (AUTO) / MANUAL (EXTRA)
   - Alarma: OK / ACTIVA

### **Paso 3: Probar Gráficas en Tiempo Real**
1. Las gráficas deben comenzar a dibujarse automáticamente
2. Observa que el **contador de puntos** aumenta
3. Las líneas deben ser fluidas (sin saltos)
4. Verifica que muestre los últimos 500 puntos

### **Paso 4: Simular Cambio de Nivel (Agregar Agua)**
1. Agrega agua al tanque físico
2. Observa en **tiempo real**:
   - 📊 **Gráfica de Nivel**: la línea verde sube
   - 📊 **Gráfica de Flujo**: puede aumentar
   - 📊 **Gráfica de Presión**: aumenta con el flujo
   - 📊 **Gráfica de PWM**: el PID ajusta la bomba
3. Las tarjetas superiores deben reflejar los cambios
4. Si alcanza el nivel de alarma (>90%), debe activarse 🚨

### **Paso 5: Probar Botones de Control**

#### **START:**
1. Haz clic en **▶️ START**
2. Verifica en consola: `▶️ Comando: START enviado`
3. El indicador de Estado debe cambiar a **RUNNING**
4. El PWM debe comenzar a ajustarse

#### **STOP:**
1. Haz clic en **⏹️ STOP**
2. Verifica en consola: `⏹️ Comando: STOP enviado`
3. El indicador de Estado debe cambiar a **STOPPED**
4. El PWM debe ir a 0

#### **START-EXTRA (Modo Manual):**
1. Haz clic en **🛠️ START-EXTRA**
2. Verifica en consola: `🛠️ Comando: START-EXTRA enviado (Modo Manual)`
3. El indicador de Modo debe cambiar a **MANUAL (EXTRA)** 🛠️
4. El PWM debe ir a 255 (máximo)
5. Este modo ignora el PID y alarmas

#### **STOP-EXTRA:**
1. Haz clic en **🔧 STOP-EXTRA**
2. Verifica en consola: `🔧 Comando: STOP-EXTRA enviado`
3. Sale del modo manual y detiene el sistema

### **Paso 6: Probar Setpoint**
1. Cambia el valor del **Setpoint** (ej: 80 → 70)
2. Haz clic en **🎯 Enviar SP**
3. Verifica en consola: `🎯 Setpoint actualizado: 70%`
4. El Arduino debe ajustar el PID al nuevo objetivo

### **Paso 7: Probar PID Tunings**
1. Cambia **Kp** (ej: 1.2 → 1.5)
2. Haz clic en **✓ Enviar**
3. Verifica en consola: `⚙️ Kp actualizado: 1.5`
4. Repite con **Ki** y **Kd**
5. Observa cómo cambia el comportamiento del sistema

### **Paso 8: Probar SD Card**
1. Haz clic en **📋 SD-STATUS**
2. Verifica en consola: `📋 Consultando estado de SD...`
3. El Arduino debe responder con el estado
4. Haz clic en **📝 SD-NEWFILE**
5. Verifica que se crea un nuevo archivo de log

### **Paso 9: Exportar CSV**
1. Deja que se acumulen datos (al menos 100 puntos)
2. Haz clic en **📥 Exportar CSV**
3. Verifica en consola: `✓ Exportado: XXX registros a CSV`
4. Se debe descargar un archivo: `telemetria_YYYY-MM-DDTHH-MM-SS.csv`
5. Abre el CSV y verifica las columnas:
   - time_ms
   - level_pct
   - flow_lpm
   - pressure_kpa
   - pwm
   - alarm
   - running
   - manual

### **Paso 10: Limpiar Memoria**
1. Haz clic en **🗑️ Limpiar memoria**
2. Confirma en el diálogo
3. Las gráficas deben limpiarse
4. El contador de puntos debe volver a 0
5. Verifica en consola: `🗑️ Memoria limpiada`

---

## 🎯 Checklist de Verificación

### Conexión y Datos
- [ ] Se conecta al Arduino sin errores
- [ ] Recibe datos cada 200ms
- [ ] Las tarjetas se actualizan en tiempo real
- [ ] Los indicadores reflejan el estado correcto

### Gráficas
- [ ] Gráfica de Nivel muestra datos en verde
- [ ] Gráfica de Flujo muestra datos en azul
- [ ] Gráfica de Presión muestra datos en naranja (línea punteada)
- [ ] Gráfica de PWM muestra datos en violeta
- [ ] Las gráficas son fluidas (sin lag)
- [ ] El contador de puntos funciona
- [ ] Los tooltips muestran valores correctos

### Botones de Control
- [ ] START funciona y muestra mensaje en consola
- [ ] STOP funciona y muestra mensaje en consola
- [ ] START-EXTRA activa modo manual
- [ ] STOP-EXTRA sale del modo manual
- [ ] Todos los botones están deshabilitados sin conexión

### Funcionalidades
- [ ] Setpoint se actualiza correctamente
- [ ] Kp, Ki, Kd se actualizan correctamente
- [ ] SD-STATUS consulta el estado
- [ ] SD-NEWFILE crea nuevo archivo
- [ ] Exportar CSV funciona y descarga archivo
- [ ] Exportar CSV está deshabilitado sin datos
- [ ] Limpiar memoria pide confirmación
- [ ] Limpiar memoria borra las gráficas

### Respuesta a Cambios Físicos
- [ ] Agregar agua aumenta el nivel en gráfica
- [ ] El flujo responde al cambio
- [ ] La presión responde al cambio
- [ ] El PWM ajusta automáticamente en modo AUTO
- [ ] Las alarmas se activan correctamente

---

## 🐛 Solución de Problemas

### **Las gráficas no se actualizan:**
1. Verifica que el Arduino esté enviando datos en formato correcto:
   `DATA,<ms>,<nivel%>,<flow>,<kPa>,<PWM>,<alarm>,<running>,<manual>`
2. Abre la consola del navegador (F12) y busca errores
3. Verifica que el punto verde esté pulsando (conexión activa)

### **Los botones no responden:**
1. Verifica la conexión (punto verde)
2. Revisa la consola del navegador por errores
3. Intenta desconectar y reconectar

### **No se exporta el CSV:**
1. Verifica que haya datos acumulados
2. Permite las descargas en el navegador
3. Revisa la consola del navegador por errores

### **Desconexión frecuente:**
1. Verifica el cable USB
2. Comprueba que el baud rate sea 9600
3. Revisa que el sketch Arduino esté funcionando

---

## 📝 Formato de Datos Esperado

El Arduino debe enviar líneas en este formato exacto:

```
DATA,<tiempo_ms>,<nivel_%>,<flujo_lpm>,<presion_kpa>,<pwm>,<alarm>,<running>,<manual>
```

**Ejemplo:**
```
DATA,12500,75.3,2.45,15.8,180,0,1,0
```

Donde:
- `12500` = 12.5 segundos desde inicio
- `75.3` = Nivel al 75.3%
- `2.45` = Flujo de 2.45 L/min
- `15.8` = Presión de 15.8 kPa
- `180` = PWM en 180
- `0` = Sin alarma
- `1` = Sistema running
- `0` = Modo automático (no manual)

---

## 🎨 Características Visuales

### **Colores por Estado:**
- 🟢 **Running**: Fondo verde esmeralda
- 🟡 **Manual**: Fondo ámbar
- 🔴 **Alarma**: Fondo rojo/rosa

### **Efectos de Interacción:**
- Hover en botones: escala 105%
- Transiciones suaves: 200ms
- Punto pulsante de conexión
- Tooltips con fondo oscuro

### **Responsive:**
- Diseño adaptable a móviles
- Grids que se reorganizan
- Botones que se ajustan

---

## 🚀 Próximos Pasos

1. **Conecta tu Arduino**
2. **Abre http://localhost:5173/**
3. **Haz clic en 🔌 Conectar**
4. **Observa las gráficas en tiempo real**
5. **Prueba todos los botones**
6. **Agrega agua y observa los cambios**
7. **Exporta los datos a CSV**

¡Todo está listo para funcionar! 🎉
