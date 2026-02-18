require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Product = require('./models/Product');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dg3e6buy5',
  api_key: process.env.CLOUDINARY_API_KEY || '368337259342651',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'b-9OsvrOuumqaC9rJ9yxzNH354E'
});

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de multer para memoria (no guardar en disco)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Conectar a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/flstore';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Conectado a MongoDB');
    // Inicializar usuario admin si no existe
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      await User.create({
        username: 'MrFercho',
        password: '1623Fercho'
      });
      console.log('✅ Usuario admin creado');
    }
  })
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// ============ RUTAS ============

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'FL Store API running' });
});

// Obtener todos los productos
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Obtener un producto por ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ error: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// Crear producto
app.post('/api/products', async (req, res) => {
  try {
    const newProduct = await Product.create({
      id: Date.now().toString(),
      ...req.body
    });
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// Actualizar producto
app.put('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { id: req.params.id },
      { ...req.body, id: req.params.id },
      { new: true }
    );
    if (product) {
      res.json(product);
    } else {
      res.status(404).json({ error: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// Eliminar producto
app.delete('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ id: req.params.id });
    if (product) {
      res.json({ message: 'Producto eliminado' });
    } else {
      res.status(404).json({ error: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Subir imagen a Cloudinary
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }

    // Subir imagen a Cloudinary usando buffer
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: 'fl-store',
          resource_type: 'image'
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.json({ url: result.secure_url });
  } catch (error) {
    console.error('Error al subir imagen a Cloudinary:', error);
    res.status(500).json({ error: 'Error al subir imagen' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) {
      res.json({ success: true, message: 'Login exitoso' });
    } else {
      res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error en login' });
  }
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 FL Store API corriendo en http://localhost:${PORT}`);
  console.log(`📦 Base de datos: MongoDB\n`);
});
