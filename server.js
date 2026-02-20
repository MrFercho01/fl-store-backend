require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const Product = require('./models/Product');
const User = require('./models/User');
const Review = require('./models/Review');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dg3e6buy5',
  api_key: process.env.CLOUDINARY_API_KEY || '368337259342651',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'b-9OsvrOuumqaC9rJ9yxzNH354E'
});

// Middleware
app.use(cors());
app.use(express.json());

const createLimiter = ({ windowMs, max, message }) => {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
};

const apiLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.',
});

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Demasiados intentos de login. Espera 15 minutos.',
});

const reviewCreationLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 1,
  message: 'Solo se permite enviar 1 comentario cada 5 minutos por IP.',
});

const reviewLikeLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Demasiados likes en poco tiempo. Intenta en 5 minutos.',
});

const likeCooldownMap = new Map();
const LIKE_ACTION_COOLDOWN_MS = 15 * 1000;

const validateLikeCooldown = (req, res, next) => {
  const visitorId = String(req.body?.visitorId || '').trim();
  const reviewId = String(req.params?.id || '').trim();

  if (!visitorId || !reviewId) {
    return res.status(400).json({ error: 'Faltan datos para procesar like' });
  }

  const key = `${reviewId}:${visitorId}`;
  const now = Date.now();
  const previous = likeCooldownMap.get(key);

  if (previous && now - previous < LIKE_ACTION_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Espera unos segundos antes de volver a reaccionar.' });
  }

  likeCooldownMap.set(key, now);
  return next();
};

app.use('/api', apiLimiter);

// Configuración de multer para memoria (no guardar en disco)
const storage = multer.memoryStorage();
const upload = multer({ storage });

const REVIEW_NOTIFICATION_EMAIL = process.env.REVIEW_NOTIFICATION_EMAIL || 'fernando.lara.moran@gmail.com';

const createMailTransporter = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
};

const sendReviewNotificationEmail = async (review) => {
  try {
    const transporter = createMailTransporter();
    if (!transporter) {
      console.warn('⚠️ SMTP no configurado. Se guardó la reseña pero no se envió correo.');
      return;
    }

    const subject = `Nueva reseña pendiente de aprobación - ${review.productName}`;
    const text = [
      'Se recibió un nuevo comentario en FL Store.',
      '',
      `Cliente: ${review.customerName}`,
      `Producto: ${review.productName}`,
      `Categoría: ${review.category}`,
      `Calificación: ${review.rating}/5`,
      `Comentario: ${review.comment}`,
      `Estado: ${review.status}`,
      `Fecha: ${new Date(review.createdAt).toLocaleString('es-EC')}`,
    ].join('\n');

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: REVIEW_NOTIFICATION_EMAIL,
      subject,
      text,
    });
  } catch (error) {
    console.error('❌ Error enviando correo de reseña:', error.message);
  }
};

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
app.post('/api/login', loginLimiter, async (req, res) => {
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

// Crear reseña (pública, queda pendiente de aprobación)
app.post('/api/reviews', reviewCreationLimiter, async (req, res) => {
  try {
    const { customerName, productId, productName, category, rating, comment, recommend } = req.body;

    if (!customerName || !productId || !productName || !category || !rating || !comment) {
      return res.status(400).json({ error: 'Faltan campos obligatorios para la reseña' });
    }

    const normalizedRating = Number(rating);
    if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
      return res.status(400).json({ error: 'La calificación debe estar entre 1 y 5' });
    }

    const review = await Review.create({
      customerName: String(customerName).trim(),
      productId: String(productId).trim(),
      productName: String(productName).trim(),
      category: String(category).trim(),
      rating: normalizedRating,
      comment: String(comment).trim(),
      recommend: Boolean(recommend),
      status: 'pending',
    });

    await sendReviewNotificationEmail(review);

    res.status(201).json({
      message: 'Tu comentario será verificado por seguridad antes de publicarse',
      review,
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear reseña' });
  }
});

// Obtener reseñas públicas (2 mejores + 2 más bajas) y métricas
app.get('/api/reviews/public', async (req, res) => {
  try {
    const visitorId = String(req.query.visitorId || '').trim();

    const topRated = await Review.find({ status: 'approved' })
      .sort({ rating: -1, createdAt: -1 })
      .limit(2);

    const lowRated = await Review.find({ status: 'approved' })
      .sort({ rating: 1, createdAt: -1 })
      .limit(2);

    const mergedMap = new Map();
    [...topRated, ...lowRated].forEach((item) => {
      mergedMap.set(String(item._id), item);
    });

    const selectedReviews = Array.from(mergedMap.values()).map((review) => {
      const visitorLikes = Array.isArray(review.visitorLikes) ? review.visitorLikes : [];
      return {
        ...review.toObject(),
        likeCount: (review.recommend ? 1 : 0) + visitorLikes.length,
        likedByVisitor: visitorId ? visitorLikes.includes(visitorId) : false,
      };
    });

    const approvedStats = await Review.aggregate([
      { $match: { status: 'approved' } },
      {
        $group: {
          _id: null,
          totalReviews: { $sum: 1 },
          averageRating: { $avg: '$rating' },
          totalLikes: {
            $sum: {
              $add: [
                { $cond: [{ $eq: ['$recommend', true] }, 1, 0] },
                { $size: { $ifNull: ['$visitorLikes', []] } },
              ],
            },
          },
        },
      },
    ]);

    const stats = approvedStats[0] || { totalReviews: 0, averageRating: 0, totalLikes: 0 };

    res.json({
      reviews: selectedReviews,
      stats: {
        totalReviews: stats.totalReviews,
        averageRating: Number(stats.averageRating || 0),
        totalLikes: stats.totalLikes,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseñas públicas' });
  }
});

// Dar like o quitar like a reseña por visitante
app.patch('/api/reviews/:id/like', reviewLikeLimiter, validateLikeCooldown, async (req, res) => {
  try {
    const { visitorId, liked } = req.body;

    const normalizedVisitorId = String(visitorId || '').trim();
    if (!normalizedVisitorId) {
      return res.status(400).json({ error: 'visitorId es obligatorio' });
    }

    const shouldLike = Boolean(liked);

    const updateOperation = shouldLike
      ? { $addToSet: { visitorLikes: normalizedVisitorId } }
      : { $pull: { visitorLikes: normalizedVisitorId } };

    const review = await Review.findByIdAndUpdate(req.params.id, updateOperation, { new: true });

    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    const visitorLikes = Array.isArray(review.visitorLikes) ? review.visitorLikes : [];
    const likeCount = (review.recommend ? 1 : 0) + visitorLikes.length;

    return res.json({
      reviewId: review._id,
      likeCount,
      likedByVisitor: visitorLikes.includes(normalizedVisitorId),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar like de reseña' });
  }
});

// Obtener reseñas para panel admin
app.get('/api/reviews/admin', async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseñas para admin' });
  }
});

// Cambiar estado de reseña (aprobar/rechazar)
app.patch('/api/reviews/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({ error: 'Reseña no encontrada' });
    }

    res.json(review);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar estado de reseña' });
  }
});

// Arrancar servidor
app.listen(PORT, () => {
  console.log(`\n🚀 FL Store API corriendo en http://localhost:${PORT}`);
  console.log(`📦 Base de datos: MongoDB\n`);
});
