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
const SiteMetric = require('./models/SiteMetric');

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
const visitRegisterLimiter = createLimiter({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Demasiados registros de visita en poco tiempo.',
});

const REVIEW_NOTIFICATION_EMAIL = process.env.REVIEW_NOTIFICATION_EMAIL || 'fernando.lara.moran@gmail.com';
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || '').trim();
const RESEND_FROM = String(process.env.RESEND_FROM || '').trim();

const isValidEmail = (value) => {
  const normalized = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
};

const parseBooleanEnv = (value) => {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  return null;
};

const getSmtpConfig = () => {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  const secureFromEnv = parseBooleanEnv(process.env.SMTP_SECURE);
  const secure = secureFromEnv === null ? port === 465 : secureFromEnv;

  const requireTlsFromEnv = parseBooleanEnv(process.env.SMTP_REQUIRE_TLS);
  const requireTLS = requireTlsFromEnv === null ? (!secure && port === 587) : requireTlsFromEnv;

  const rejectUnauthorizedFromEnv = parseBooleanEnv(process.env.SMTP_TLS_REJECT_UNAUTHORIZED);
  const tlsRejectUnauthorized = rejectUnauthorizedFromEnv === null ? true : rejectUnauthorizedFromEnv;

  return {
    host,
    port,
    user,
    pass,
    secure,
    requireTLS,
    tlsRejectUnauthorized,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 20000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 15000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 25000),
  };
};

const getMailFromAddress = (smtpUser) => {
  const fromFromEnv = String(process.env.SMTP_FROM || '').trim();
  if (fromFromEnv) return fromFromEnv;
  return `FL Store <${smtpUser}>`;
};

const isValidFromAddress = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  if (isValidEmail(normalized)) return true;

  const namedMatch = normalized.match(/^.+<([^<>]+)>$/);
  return Boolean(namedMatch && isValidEmail(namedMatch[1]));
};

const normalizeResendFromAddress = (value, fallbackFromAddress) => {
  const raw = String(value || '').trim();
  const fallback = String(fallbackFromAddress || '').trim();

  const baseCandidate = raw || fallback || 'onboarding@resend.dev';
  const trimmedToBracket = baseCandidate.includes('>')
    ? `${baseCandidate.split('>')[0]}>`
    : baseCandidate;

  if (isValidFromAddress(trimmedToBracket)) {
    return trimmedToBracket;
  }

  if (isValidFromAddress(fallback)) {
    return fallback;
  }

  return 'onboarding@resend.dev';
};

const getReviewEmailContent = (review) => {
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

  return { subject, text };
};

const sendWithResend = async ({ subject, text, toAddress, fallbackFromAddress }) => {
  if (!RESEND_API_KEY) {
    return false;
  }

  const fromAddress = normalizeResendFromAddress(RESEND_FROM, fallbackFromAddress);
  if (!isValidEmail(toAddress) || !isValidFromAddress(fromAddress)) {
    console.warn('⚠️ Configuración inválida para Resend.');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        subject,
        text,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('❌ Resend falló:', response.status, errorBody);
      return false;
    }

    console.log(`📨 Correo de reseña enviado por Resend a ${toAddress}`);
    return true;
  } catch (error) {
    console.error('❌ Error enviando con Resend:', error?.message || 'Sin detalle');
    return false;
  }
};

const logSmtpConfig = () => {
  const config = getSmtpConfig();
  const hasCredentials = Boolean(config.host && config.port && config.user && config.pass);

  console.log(
    `✉️ SMTP config => host=${config.host || 'N/A'} port=${config.port} secure=${config.secure} requireTLS=${config.requireTLS} user=${config.user || 'N/A'} auth=${hasCredentials ? 'ok' : 'missing'}`
  );
};

const createMailTransporter = () => {
  const config = getSmtpConfig();
  const { host, port, user, pass } = config;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    auth: {
      user,
      pass,
    },
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: config.tlsRejectUnauthorized,
      servername: host,
    },
  });
};

const verifyMailTransport = async () => {
  try {
    const transporter = createMailTransporter();
    if (!transporter) {
      if (RESEND_API_KEY) {
        console.warn('⚠️ SMTP no configurado. Se usará Resend como proveedor principal.');
      } else {
        console.warn('⚠️ SMTP no configurado: faltan variables requeridas.');
      }
      return;
    }

    await transporter.verify();
    console.log('✅ SMTP conectado y listo para enviar correos');
  } catch (error) {
    console.error('❌ SMTP verify falló:', error?.code || error?.name || 'UnknownError', error?.message || 'Sin detalle');
    if (RESEND_API_KEY) {
      console.warn('ℹ️ Se intentará enviar correos con Resend cuando SMTP falle.');
    }
  }
};

const sendReviewNotificationEmail = async (review) => {
  const { subject, text } = getReviewEmailContent(review);
  const smtpConfig = getSmtpConfig();
  const fromAddress = getMailFromAddress(smtpConfig.user);
  const toAddress = isValidEmail(REVIEW_NOTIFICATION_EMAIL)
    ? REVIEW_NOTIFICATION_EMAIL
    : smtpConfig.user;

  if (!isValidEmail(toAddress)) {
    console.warn('⚠️ REVIEW_NOTIFICATION_EMAIL y SMTP_USER inválidos. No se envía correo de reseña.');
    return;
  }

  try {
    const transporter = createMailTransporter();
    if (!transporter) {
      const sentWithResend = await sendWithResend({
        subject,
        text,
        toAddress,
        fallbackFromAddress: fromAddress,
      });

      if (!sentWithResend) {
        console.warn('⚠️ SMTP/Resend no configurados. Se guardó la reseña pero no se envió correo.');
      }
      return;
    }

    await transporter.sendMail({
      from: fromAddress,
      to: toAddress,
      subject,
      text,
    });

    console.log(`📨 Correo de reseña enviado a ${toAddress}`);
  } catch (error) {
    console.error('❌ Error enviando correo de reseña:', error?.code || error?.name || 'UnknownError', error?.message || 'Sin detalle');

    const sentWithResend = await sendWithResend({
      subject,
      text,
      toAddress,
      fallbackFromAddress: fromAddress,
    });

    if (!sentWithResend) {
      console.warn('⚠️ Falló SMTP y no se pudo enviar por Resend.');
    }
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

// Métricas públicas del sitio
app.get('/api/metrics/public', async (req, res) => {
  try {
    const visitsMetric = await SiteMetric.findOne({ key: 'site_visits' });
    const totalVisits = Number(visitsMetric?.value ?? 0);

    return res.json({
      totalVisits,
      updatedAt: visitsMetric?.updatedAt ?? null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener métricas públicas' });
  }
});

// Registrar visita de sitio
app.post('/api/metrics/visit', visitRegisterLimiter, async (req, res) => {
  try {
    const visitorId = String(req.body?.visitorId || '').trim();
    if (!visitorId) {
      return res.status(400).json({ error: 'visitorId es obligatorio' });
    }

    const updatedMetric = await SiteMetric.findOneAndUpdate(
      { key: 'site_visits' },
      { $inc: { value: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({
      totalVisits: Number(updatedMetric?.value ?? 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al registrar visita' });
  }
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
  logSmtpConfig();
  if (RESEND_API_KEY) {
    console.log('✉️ Resend fallback habilitado');
  }
  void verifyMailTransport();
});
