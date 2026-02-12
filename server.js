const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = './uploads';
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      console.error('Error creating uploads directory:', err);
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Rutas de base de datos
const DB_PATH = './db.json';

// Inicializar base de datos
async function initDB() {
  try {
    await fs.access(DB_PATH);
  } catch {
    const initialData = {
      products: [
        {
          id: '1',
          name: 'Producto Premium 1',
          description: 'Producto innovador con tecnología de última generación',
          price: 299.99,
          image: 'https://picsum.photos/400/400?random=1',
          category: 'Tecnología',
          isNew: true,
        },
        {
          id: '2',
          name: 'Producto Premium 2',
          description: 'Diseño futurista y funcionalidad avanzada',
          price: 499.99,
          image: 'https://picsum.photos/400/400?random=2',
          category: 'Premium',
          isNew: true,
        },
        {
          id: '3',
          name: 'Producto Especial 3',
          description: 'Calidad superior para clientes exigentes',
          price: 199.99,
          image: 'https://picsum.photos/400/400?random=3',
          category: 'Especial',
          isNew: false,
        },
        {
          id: '4',
          name: 'Producto Elite 4',
          description: 'La mejor opción del mercado actual',
          price: 799.99,
          image: 'https://picsum.photos/400/400?random=4',
          category: 'Elite',
          isNew: true,
        },
      ],
      users: [
        {
          username: 'MrFercho',
          password: '1623Fercho'
        }
      ]
    };
    await fs.writeFile(DB_PATH, JSON.stringify(initialData, null, 2));
  }
}

// Funciones helper
async function readDB() {
  const data = await fs.readFile(DB_PATH, 'utf8');
  return JSON.parse(data);
}

async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

// ============ RUTAS ============

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'FL Store API running' });
});

// Obtener todos los productos
app.get('/api/products', async (req, res) => {
  try {
    const db = await readDB();
    res.json(db.products);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// Obtener un producto por ID
app.get('/api/products/:id', async (req, res) => {
  try {
    const db = await readDB();
    const product = db.products.find(p => p.id === req.params.id);
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
    const db = await readDB();
    const newProduct = {
      id: Date.now().toString(),
      ...req.body
    };
    db.products.unshift(newProduct);
    await writeDB(db);
    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// Actualizar producto
app.put('/api/products/:id', async (req, res) => {
  try {
    const db = await readDB();
    const index = db.products.findIndex(p => p.id === req.params.id);
    if (index !== -1) {
      db.products[index] = { ...req.body, id: req.params.id };
      await writeDB(db);
      res.json(db.products[index]);
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
    const db = await readDB();
    const filtered = db.products.filter(p => p.id !== req.params.id);
    if (filtered.length < db.products.length) {
      db.products = filtered;
      await writeDB(db);
      res.json({ message: 'Producto eliminado' });
    } else {
      res.status(404).json({ error: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Subir imagen
app.post('/api/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    }
    // Usar la IP local en lugar de localhost para que funcione en móvil
    const host = req.get('host') || `192.168.3.115:${PORT}`;
    const protocol = req.protocol;
    const imageUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    res.json({ url: imageUrl });
  } catch (error) {
    res.status(500).json({ error: 'Error al subir imagen' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = await readDB();
    const user = db.users.find(u => u.username === username && u.password === password);
    if (user) {
      res.json({ success: true, message: 'Login exitoso' });
    } else {
      res.status(401).json({ success: false, error: 'Credenciales incorrectas' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error en login' });
  }
});

// Inicializar y arrancar servidor
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🚀 FL Store API corriendo en http://localhost:${PORT}`);
    console.log(`📦 Base de datos: ${path.resolve(DB_PATH)}\n`);
  });
});
