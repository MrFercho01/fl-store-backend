# FL Store Backend

API REST para FL Store (Mobile y Web) con **MongoDB Atlas** (almacenamiento permanente)

## 🚀 Instalación

```bash
npm install
```

## ⚙️ Configuración

1. Copia el archivo `.env` y configura tus variables:
   ```env
   MONGODB_URI=mongodb+srv://usuario:password@cluster.mongodb.net/flstore
   ```

2. **Configurar MongoDB Atlas** - Consulta [MONGODB_SETUP.md](./MONGODB_SETUP.md) para guía completa

## 📦 Migrar datos existentes

Si tienes productos en `db.json`:

```bash
npm run migrate
```

## 🏃 Iniciar servidor

```bash
npm start
```

## Endpoints

- GET `/api/products` - Obtener todos los productos
- GET `/api/products/:id` - Obtener un producto
- POST `/api/products` - Crear producto
- PUT `/api/products/:id` - Actualizar producto
- DELETE `/api/products/:id` - Eliminar producto
- POST `/api/upload` - Subir imagen a Cloudinary
- POST `/api/login` - Login de admin
- GET `/downloads/fl-store-mobile.apk` - Descargar APK Android local (si existe en `backend/downloads`)
- GET `/downloads/releases/:fileName` - Descargar una versión específica del APK
- GET `/api/mobile/apk-info` - Estado, URL y contador de descargas del APK
- GET `/api/mobile/apk-releases` - Listar historial de APKs versionados
- POST `/api/mobile/push/test` - Enviar notificación push de prueba a tokens activos

## APK local sin hosting externo

Para instalar Android directo desde tu red local (sin Expo y sin host externo):

1. Copia tu archivo APK dentro de `backend/downloads/` con nombre `fl-store-mobile.apk`.
2. Inicia backend (`npm start`).
3. Abre en tu celular (misma WiFi): `http://IP_DE_TU_MAC:3000/downloads/fl-store-mobile.apk`.

Opcional en `.env`:

```env
MOBILE_APK_FILE_NAME=fl-store-mobile.apk
```

## Versionamiento de APK (referencias)

Al ejecutar en `fl-store-mobile`:

```bash
npm run build:android:apk
```

Se generan automáticamente:

- Alias estable: `backend/downloads/fl-store-mobile.apk`
- Copia versionada: `backend/downloads/releases/fl-store-mobile-v<versionName>+<versionCode>-<buildId>.apk`
- Metadata de la última build: `backend/downloads/releases/latest.json`

Esto permite mantener historial y referencias por versión sin romper el link principal de descarga.

## 💾 Base de Datos

- **MongoDB Atlas** (permanente en la nube)
- Los productos ya NO se pierden al reiniciar
- Almacenamiento gratis de 512MB

## Puerto

Por defecto: 3000
