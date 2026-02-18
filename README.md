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

## 💾 Base de Datos

- **MongoDB Atlas** (permanente en la nube)
- Los productos ya NO se pierden al reiniciar
- Almacenamiento gratis de 512MB

## Puerto

Por defecto: 3000
