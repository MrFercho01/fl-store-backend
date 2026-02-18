# 🎯 INICIO RÁPIDO - Productos Permanentes

## ✅ Lo que se ha configurado

Ya tienes el backend listo para usar **MongoDB Atlas** (base de datos permanente en la nube).

### Archivos creados/modificados:
- ✅ `models/Product.js` - Modelo de productos para MongoDB
- ✅ `models/User.js` - Modelo de usuarios para MongoDB  
- ✅ `server.js` - Actualizado para usar MongoDB en lugar de archivo JSON
- ✅ `migrate.js` - Script para migrar tus productos (PlayStation 5, iPhone 17) a MongoDB
- ✅ `.env` - Archivo de configuración (necesitas actualizar MONGODB_URI)
- ✅ `package.json` - Agregado comando `npm run migrate`

## 🚀 SIGUIENTE PASO (OBLIGATORIO)

### Opción A: Configurar MongoDB Atlas (RECOMENDADO - Gratis y permanente)

1. **Crea tu cuenta gratuita en MongoDB Atlas**
   - Sigue la guía completa en: `MONGODB_SETUP.md`
   - Toma ~5 minutos
   
2. **Obtén tu string de conexión**
   - Ejemplo: `mongodb+srv://usuario:password@cluster.mongodb.net/flstore`

3. **Actualiza el archivo .env**
   ```env
   MONGODB_URI=mongodb+srv://tu-usuario:tu-password@tu-cluster.mongodb.net/flstore
   ```

4. **Migra tus productos actuales**
   ```bash
   cd backend
   npm run migrate
   ```
   Esto migrará PlayStation 5 e iPhone 17 Pro Max a MongoDB

5. **Inicia el servidor**
   ```bash
   npm start
   ```

6. **Configura Render**
   - Ve a tu proyecto en Render
   - Agrega variable de entorno: `MONGODB_URI` con tu conexión
   - Render redesplegará automáticamente

### Opción B: Probar localmente con MongoDB local

Si solo quieres probar localmente:

```bash
# Instalar MongoDB en tu Mac
brew install mongodb-community

# Iniciar MongoDB
brew services start mongodb-community

# El .env ya tiene configurado: mongodb://localhost:27017/flstore

# Migrar productos
npm run migrate

# Iniciar servidor
npm start
```

## 🎉 Resultado Final

Una vez completado:
- ✅ Productos guardados permanentemente en MongoDB
- ✅ Ya NO se pierden cuando Render se reinicia  
- ✅ PlayStation 5 e iPhone 17 Pro Max siempre disponibles
- ✅ Puedes agregar más productos sin preocuparte

## ⚙️ Frontend

No olvides actualizar el frontend para apuntar al backend correcto:

**Si usas backend local:**
`fl-store-mobile/src/services/api.ts`:
```typescript
const API_URL = 'http://192.168.3.115:3000/api';
```

**Si usas backend en Render:**
```typescript
const API_URL = 'https://fl-store-backend.onrender.com/api';
```

## 📞 Ayuda

Si tienes dudas, consulta:
- `MONGODB_SETUP.md` - Guía paso a paso completa
- `README.md` - Documentación general

---

**RECUERDA**: Sin MongoDB configurado, los productos seguirán usando el archivo JSON temporal.
