# 🁣 Dominó Scorer

App móvil para anotar los tantos en partidas de dominó, con detección de puntos por cámara usando visión computacional.

## Funcionalidades

- **Marcador en vivo** — Equipos "Corto" y "Largo" por defecto (renombrables)
- **Detección por cámara** — Cuenta los puntos de las fichas usando CV local, sin internet, funciona con dominós de cualquier color
- **Historial de jugadas** — Con método (cámara/manual), exportable
- **8 temas de colores** — Clásico, Tropical, Noche, Fuego, Océano, Uva, Blanco, Verde
- **Meta configurable** — 50 a 500 puntos
- **Persistencia** — El estado se guarda entre sesiones
- **Haptics** — Vibración en cada acción

---

## Requisitos previos

- Node.js 18+
- npm o yarn
- Cuenta en [expo.dev](https://expo.dev) (gratis)

---

## Instalación y desarrollo

```bash
# 1. Instalar dependencias
npm install

# 2. Instalar Expo CLI globalmente (si no lo tienes)
npm install -g expo-cli eas-cli

# 3. Arrancar el servidor de desarrollo
npx expo start
```

Luego escanea el QR con la app **Expo Go** en tu teléfono (iOS o Android).

---

## Publicar en Play Store y App Store

### Paso 1 — Crear cuenta EAS

```bash
# Iniciar sesión en Expo
eas login

# Configurar el proyecto
eas build:configure
```

### Paso 2 — Cambiar identifiers en app.json

Edita `app.json` y cambia:
- `ios.bundleIdentifier`: algo único tuyo, ej. `com.miguelgarcia.dominoscorer`
- `android.package`: igual, ej. `com.miguelgarcia.dominoscorer`

### Paso 3 — Build para Android (Play Store)

```bash
# Build de producción .aab (Google Play)
eas build --platform android --profile production
```

EAS Build compila en la nube. No necesitas Android Studio instalado.
Te devolverá un archivo `.aab` para subir a Google Play Console.

### Paso 4 — Build para iOS (App Store)

```bash
# Build de producción .ipa
eas build --platform ios --profile production
```

> **Importante**: Necesitas una cuenta de Apple Developer ($99/año).
> EAS maneja los certificados automáticamente — te pedirá tus credenciales de Apple la primera vez.

### Paso 5 — Subir a las tiendas

**Android:**
1. Crea la app en [Google Play Console](https://play.google.com/console)
2. Sube el `.aab`
3. Completa el listing (descripción, capturas de pantalla)
4. Publica

```bash
# O automatizado con EAS Submit:
eas submit --platform android
```

**iOS:**
1. Crea la app en [App Store Connect](https://appstoreconnect.apple.com)
2. Sube el `.ipa` via Xcode o Transporter (Mac) o EAS Submit

```bash
# Automatizado:
eas submit --platform ios
```

---

## Estructura del proyecto

```
domino-scorer/
├── app/
│   ├── _layout.tsx          # Root layout, carga estado inicial
│   └── (tabs)/
│       ├── _layout.tsx      # Tab bar con iconos
│       ├── index.tsx        # 📊 Pantalla de marcador
│       ├── camera.tsx       # 📷 Detector de fichas por cámara
│       ├── history.tsx      # 📋 Historial de jugadas
│       └── settings.tsx     # ⚙️ Configuración y temas
├── components/              # Componentes reutilizables (expandir aquí)
├── hooks/
│   └── useGameStore.ts      # Estado global con Zustand + AsyncStorage
├── utils/
│   └── dotDetection.ts      # Algoritmo CV de detección de puntos
├── constants/
│   └── themes.ts            # 8 temas de colores
├── app.json                 # Config de Expo
└── eas.json                 # Config de EAS Build
```

---

## Cómo funciona la detección por cámara

El algoritmo en `utils/dotDetection.ts` usa visión computacional pura en JavaScript:

1. **Escala de grises** — Convierte la imagen RGB a luminancia
2. **Blur gaussiano** — Reduce ruido con kernel 3×3
3. **Umbral de Otsu** — Calcula automáticamente el umbral óptimo basado en el histograma de la imagen. Esto hace que funcione con dominós de **cualquier color** — negro sobre blanco, blanco sobre negro, verde sobre azul, etc.
4. **Componentes conectados** — Etiqueta manchas oscuras (pepas/puntos)
5. **Filtro por área** — Descarta manchas demasiado pequeñas (ruido) o grandes (no son puntos)
6. **Clustering** — Agrupa puntos cercanos para identificar fichas individuales

**Para mejores resultados:**
- Buena iluminación (luz natural o lampara directa)
- Fondo de color sólido que contraste con las fichas
- Fichas planas sobre la mesa
- Cámara perpendicular a las fichas (desde arriba)

---

## Expandir con Claude Vision API (opcional)

Si quieres más precisión, puedes reemplazar el algoritmo local con la API de Claude.
Costo estimado: ~$0.005 por foto.

En `app/(tabs)/camera.tsx`, reemplaza la llamada a `detectDominoDotsFromPixels` con:

```typescript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': TU_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'Cuenta exactamente cuántos puntos/pepas hay en total en todas las fichas de dominó visibles. Responde SOLO con el número entero.' }
      ]
    }]
  })
});
const data = await response.json();
const totalDots = parseInt(data.content[0].text);
```

---

## Costos de publicación

| Plataforma | Costo |
|---|---|
| Google Play Console | $25 pago único |
| Apple Developer Program | $99/año |
| EAS Build (builds mensuales) | Gratis hasta 30 builds/mes |
| Hosting API Anthropic (opcional) | ~$5-15/mes con 100 usuarios activos |
