# 🚀 Guía de Configuración - MongoDB Atlas (PERMANENTE)

Esta guía te ayudará a migrar tu backend de FL Store de archivo JSON (temporal) a MongoDB Atlas (permanente y gratis).

## ✅ ¿Por qué MongoDB Atlas?

- ✅ **Gratuito**: Plan gratis con 512MB de almacenamiento
- ✅ **Permanente**: Los datos NO se pierden al reiniciar
- ✅ **En la nube**: Accesible desde cualquier lugar
- ✅ **Fácil de usar**: No requiere configuración complicada

## 📋 Paso 1: Crear cuenta en MongoDB Atlas

1. Ve a https://www.mongodb.com/cloud/atlas/register
2. Regístrate con tu email (o usa Google/GitHub)
3. Selecciona el plan **FREE** (M0 Sandbox)
4. Elige la región más cercana (ej: AWS - US East)

## 📋 Paso 2: Crear Base de Datos

1. En el dashboard de Atlas, haz clic en **"Build a Database"**
2. Selecciona **"M0 FREE"**
3. Nombre del cluster: `flstore` (o el que prefieras)
4. Click en **"Create"**

## 📋 Paso 3: Configurar Acceso

1. **Usuario de base de datos**:
   - Click en "Database Access" (menú izquierdo)
   - Click "Add New Database User"
   - Username: `flstoreuser` (puedes cambiar)
   - Password: Genera uno seguro o usa uno propio
   - Click "Add User"

2. **IP Whitelist**:
   - Click en "Network Access" (menú izquierdo)  
   - Click "Add IP Address"
   - Selecciona **"Allow Access from Anywhere"** (0.0.0.0/0)
   - Click "Confirm"

## 📋 Paso 4: Obtener String de Conexión

1. Click en "Database" (menú izquierdo)
2. Click en **"Connect"** en tu cluster
3. Selecciona **"Connect your application"**
4. Copia el string de conexión, debe verse así:
   ```
   mongodb+srv://flstoreuser:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Reemplaza `<password>` con tu contraseña real
6. Agrega el nombre de la base de datos antes del `?`:
   ```
   mongodb+srv://flstoreuser:miPassword123@cluster0.xxxxx.mongodb.net/flstore?retryWrites=true&w=majority
   ```

## 📋 Paso 5: Configurar Backend Local

1. Abre el archivo `.env` en la carpeta `backend/`
2. Reemplaza `MONGODB_URI` con tu string de conexión:
   ```env
   MONGODB_URI=mongodb+srv://flstoreuser:tuPassword@cluster0.xxxxx.mongodb.net/flstore?retryWrites=true&w=majority
   ```

## 📋 Paso 6: Migrar tus productos

Ejecuta en la terminal (dentro de la carpeta backend):

```bash
npm run migrate
```

Esto migrará tus productos del archivo `db.json` a MongoDB.

## 📋 Paso 7: Probar localmente

```bash
npm start
```

El servidor ahora usa MongoDB y tus productos están guardados permanentemente.

## 📋 Paso 8: Desplegar en Render

1. Ve a tu proyecto en Render: https://dashboard.render.com/
2. Selecciona tu servicio `fl-store-backend`
3. Ve a "Environment" y agrega la variable:
   - Key: `MONGODB_URI`
   - Value: Tu string de conexión completo
4. Click "Save Changes"
5. Render redesplegará automáticamente

## 🎉 ¡Listo!

Ahora tus productos (PlayStation 5, iPhone 17) están guardados permanentemente en MongoDB Atlas y NUNCA se perderán aunque Render se reinicie.

## ⚠️ IMPORTANTE

**Actualiza el frontend para usar el backend en Render** (después de desplegar):

En `fl-store-mobile/src/services/api.ts`:
```typescript
const API_URL = 'https://fl-store-backend.onrender.com/api';
```

---

## 📞 Soporte

Si tienes problemas, revisa:
- Que la contraseña no tenga caracteres especiales (usa URL encoding)
- Que la IP 0.0.0.0/0 esté en la whitelist
- Que el usuario tenga permisos de lectura/escritura
