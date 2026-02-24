require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const Product = require('./models/Product');
const User = require('./models/User');
const Review = require('./models/Review');
const SiteMetric = require('./models/SiteMetric');
const SiteVisit = require('./models/SiteVisit');
const MobilePushToken = require('./models/MobilePushToken');
const MobileApkDownload = require('./models/MobileApkDownload');
const ProductChangeLog = require('./models/ProductChangeLog');

const app = express();
const PORT = process.env.PORT || 3000;
const MOBILE_DOWNLOADS_DIR = path.resolve(__dirname, 'downloads');
const MOBILE_APK_FILE_NAME = path.basename(String(process.env.MOBILE_APK_FILE_NAME || 'fl-store-mobile.apk').trim() || 'fl-store-mobile.apk');
const MOBILE_APK_FILE_PATH = path.join(MOBILE_DOWNLOADS_DIR, MOBILE_APK_FILE_NAME);
const ECUADOR_TIMEZONE = 'America/Guayaquil';
const ADMIN_JWT_SECRET = String(process.env.ADMIN_JWT_SECRET || '').trim();
const ADMIN_TOKEN_EXPIRES_IN = String(process.env.ADMIN_TOKEN_EXPIRES_IN || '12h').trim();

app.set('trust proxy', 1);

// Configurar Cloudinary
cloudinary.config({
  cloud_name: String(process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
  api_key: String(process.env.CLOUDINARY_API_KEY || '').trim(),
  api_secret: String(process.env.CLOUDINARY_API_SECRET || '').trim(),
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

app.get('/downloads/fl-store-mobile.apk', async (req, res) => {
  try {
    if (!fs.existsSync(MOBILE_APK_FILE_PATH)) {
      return res.status(404).json({
        error: 'APK no encontrado',
        detail: `Coloca el instalador en backend/downloads/${MOBILE_APK_FILE_NAME}`,
      });
    }

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${MOBILE_APK_FILE_NAME}"`);

    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    const dayKey = getDayKey();
    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 255);
    const downloadFingerprint = `${dayKey}|${normalizeIp(ipAddress) || 'unknown'}|${userAgent || 'unknown'}`;

    const existingDownload = await MobileApkDownload.exists({ fingerprint: downloadFingerprint });
    if (!existingDownload) {
      await MobileApkDownload.create({
        dayKey,
        ipAddress,
        userAgent,
        fingerprint: downloadFingerprint,
      });

      await SiteMetric.findOneAndUpdate(
        { key: 'mobile_apk_downloads' },
        { $inc: { value: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    return res.sendFile(MOBILE_APK_FILE_PATH);
  } catch (error) {
    return res.status(500).json({ error: 'Error al preparar descarga del APK' });
  }
});

app.get('/api/mobile/apk-info', async (req, res) => {
  try {
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const downloadUrl = `${protocol}://${host}/downloads/fl-store-mobile.apk`;
    const apkDownloadsMetric = await SiteMetric.findOne({ key: 'mobile_apk_downloads' });

    return res.json({
      available: fs.existsSync(MOBILE_APK_FILE_PATH),
      fileName: MOBILE_APK_FILE_NAME,
      downloadUrl,
      downloadCount: Number(apkDownloadsMetric?.value ?? 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener información de APK' });
  }
});

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
const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';

const isValidExpoPushToken = (token) => {
  const normalized = String(token || '').trim();
  return /^ExponentPushToken\[[\w-]+\]$/.test(normalized) || /^ExpoPushToken\[[\w-]+\]$/.test(normalized);
};

const normalizePlatform = (platform) => {
  const normalized = String(platform || '').trim().toLowerCase();
  if (['ios', 'android', 'web'].includes(normalized)) return normalized;
  return 'unknown';
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const deactivateInvalidExpoTokens = async (tokens = []) => {
  if (!tokens.length) return;

  await MobilePushToken.updateMany(
    { token: { $in: tokens } },
    { $set: { active: false } }
  );
};

const sendExpoPushNotificationToAll = async ({ title, body, data = {} }) => {
  const activeTokens = await MobilePushToken.find({ active: true }).select('token -_id');
  if (!activeTokens.length) {
    return { delivered: 0, invalidated: 0 };
  }

  const messages = activeTokens
    .map((item) => String(item.token || '').trim())
    .filter((token) => isValidExpoPushToken(token))
    .map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      data,
      channelId: 'default',
      priority: 'high',
    }));

  const invalidTokens = [];
  const messageChunks = chunkArray(messages, 100);

  for (const chunk of messageChunks) {
    try {
      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      const payload = await response.json().catch(() => null);
      const tickets = Array.isArray(payload?.data) ? payload.data : [];

      tickets.forEach((ticket, ticketIndex) => {
        if (ticket?.status !== 'error') return;

        const errorCode = ticket?.details?.error;
        if (errorCode === 'DeviceNotRegistered') {
          const token = chunk[ticketIndex]?.to;
          if (token) invalidTokens.push(token);
        }
      });
    } catch (error) {
      console.error('❌ Error enviando push por Expo:', error?.message || 'Sin detalle');
    }
  }

  if (invalidTokens.length) {
    await deactivateInvalidExpoTokens(invalidTokens);
  }

  return {
    delivered: messages.length,
    invalidated: invalidTokens.length,
  };
};

const notifyProductCreated = async (product) => {
  const title = '🆕 ¡Nuevos productos en nuestra tienda!';
  const body = `Llegó ${product.name} 🔥 Aprovecha y cómpralo antes que se agote.`;

  return sendExpoPushNotificationToAll({
    title,
    body,
    data: {
      type: 'new_product',
      productId: product.id,
    },
  });
};

const notifyProductPriceUpdated = async ({ product, previousPrice }) => {
  const title = '💥 ¡OFERTA IMPERDIBLE!';
  const body = `${product.name} ahora a $${Number(product.price).toFixed(2)} (antes $${Number(previousPrice).toFixed(2)}). ¡Llévalo hoy!`;

  return sendExpoPushNotificationToAll({
    title,
    body,
    data: {
      type: 'price_update',
      productId: product.id,
      previousPrice: Number(previousPrice),
      newPrice: Number(product.price),
    },
  });
};

const notifyProductUpdated = async (product) => {
  const title = '✨ ¡Producto mejorado en FL Store!';
  const body = `${product.name} tiene novedades. Entra y descúbrelas ahora.`;

  return sendExpoPushNotificationToAll({
    title,
    body,
    data: {
      type: 'product_update',
      productId: product.id,
    },
  });
};

const notifyProductEnabled = async (product) => {
  const title = '✅ ¡Vuelve a estar disponible!';
  const body = `${product.name} regresó a nuestra tienda. ¡Aprovecha antes que se termine!`;

  return sendExpoPushNotificationToAll({
    title,
    body,
    data: {
      type: 'new_product',
      productId: product.id,
    },
  });
};

const notifyProductDisabled = async (product) => {
  const title = '⚠️ Producto temporalmente sin stock';
  const body = `${product.name}: este producto no hay en stock por el momento.`;

  return sendExpoPushNotificationToAll({
    title,
    body,
    data: {
      type: 'product_disabled',
      productId: product.id,
    },
  });
};

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

const getClientIp = (req) => {
  const forwarded = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  return String(req.ip || req.socket?.remoteAddress || '').trim();
};

const normalizeIp = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const withoutPrefix = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  const withoutPort = withoutPrefix.includes(':') && withoutPrefix.split(':').length === 2
    ? withoutPrefix.split(':')[0]
    : withoutPrefix;
  return withoutPort.toLowerCase();
};

const ADMIN_IP_WHITELIST = new Set(
  String(process.env.ADMIN_IP_WHITELIST || '')
    .split(',')
    .map((item) => normalizeIp(item))
    .filter(Boolean)
);
const ADMIN_IP_PREFIX_WHITELIST = [
  ...new Set(
    String(process.env.ADMIN_IP_PREFIX_WHITELIST || '')
      .split(',')
      .map((item) => normalizeIp(item))
      .filter(Boolean)
  ),
];

const TRACKED_PRODUCT_FIELDS = ['name', 'description', 'price', 'category', 'image', 'isNew', 'isEnabled'];

const toComparableValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return value;
};

const buildProductFieldDiff = (beforeProduct, afterProduct) => {
  return TRACKED_PRODUCT_FIELDS
    .map((field) => {
      const beforeValue = toComparableValue(beforeProduct?.[field]);
      const afterValue = toComparableValue(afterProduct?.[field]);
      if (Object.is(beforeValue, afterValue)) return null;
      return {
        field,
        from: beforeValue,
        to: afterValue,
      };
    })
    .filter(Boolean);
};

const registerProductChangeLog = async ({ productId, operation, req, changedFields = [], productSnapshot = null }) => {
  if (!productId || !operation) return;
  await ProductChangeLog.create({
    productId: String(productId),
    operation,
    ipAddress: getClientIp(req),
    adminUsername: String(req.adminUser?.username || ''),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    changedFields,
    productSnapshot,
  });
};

const getBearerToken = (req) => {
  const authHeader = String(req.headers.authorization || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
};

const isAdminIpAllowed = (ipAddress) => {
  if (ADMIN_IP_WHITELIST.size === 0 && ADMIN_IP_PREFIX_WHITELIST.length === 0) {
    return true;
  }

  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp) return false;
  if (ADMIN_IP_WHITELIST.has(normalizedIp)) return true;
  return ADMIN_IP_PREFIX_WHITELIST.some((prefix) => normalizedIp.startsWith(prefix));
};

const requireAdminAuth = (req, res, next) => {
  if (!ADMIN_JWT_SECRET) {
    return res.status(500).json({ error: 'ADMIN_JWT_SECRET no configurado en el servidor' });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'No autorizado. Token requerido.' });
  }

  if (!isAdminIpAllowed(getClientIp(req))) {
    return res.status(403).json({ error: 'Acceso admin denegado para esta IP' });
  }

  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    req.adminUser = {
      username: String(payload?.username || ''),
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Inicia sesión nuevamente.' });
  }
};

const isBcryptHash = (value) => /^\$2[aby]\$\d{2}\$/.test(String(value || ''));

const verifyAndUpgradePassword = async (user, rawPassword) => {
  const savedPassword = String(user?.password || '');
  const candidate = String(rawPassword || '');
  if (!savedPassword || !candidate) return false;

  if (isBcryptHash(savedPassword)) {
    return bcrypt.compare(candidate, savedPassword);
  }

  if (savedPassword !== candidate) {
    return false;
  }

  const hashedPassword = await bcrypt.hash(candidate, 12);
  await User.updateOne({ _id: user._id }, { $set: { password: hashedPassword } });
  return true;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const INTERNAL_IP_WHITELIST = new Set(
  String(process.env.INTERNAL_IP_WHITELIST || '')
    .split(',')
    .map((item) => normalizeIp(item))
    .filter(Boolean)
);

const INTERNAL_IP_PREFIX_WHITELIST = [
  ...new Set(
    String(process.env.INTERNAL_IP_PREFIX_WHITELIST || '')
      .split(',')
      .map((item) => normalizeIp(item))
      .filter(Boolean)
  ),
];

const isInternalIpAddress = (ipAddress) => {
  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp) return false;

  if (INTERNAL_IP_WHITELIST.has(normalizedIp)) return true;
  return INTERNAL_IP_PREFIX_WHITELIST.some((prefix) => normalizedIp.startsWith(prefix));
};

const buildInternalIpConditions = () => {
  const conditions = [];

  INTERNAL_IP_WHITELIST.forEach((ip) => {
    const escapedIp = escapeRegex(ip);
    conditions.push({ ipAddress: { $regex: `^(::ffff:)?${escapedIp}(:\\d+)?$`, $options: 'i' } });
  });

  INTERNAL_IP_PREFIX_WHITELIST.forEach((prefix) => {
    const escapedPrefix = escapeRegex(prefix);
    conditions.push({ ipAddress: { $regex: `^(::ffff:)?${escapedPrefix}`, $options: 'i' } });
  });

  return conditions;
};

const buildInternalVisitQuery = (extraQuery = {}) => {
  const internalIpConditions = buildInternalIpConditions();
  return {
    ...extraQuery,
    $or: [{ isInternalVisit: true }, ...internalIpConditions],
  };
};

const buildCustomerVisitQuery = (extraQuery = {}) => {
  const internalIpConditions = buildInternalIpConditions();
  return {
    ...extraQuery,
    $nor: [{ isInternalVisit: true }, ...internalIpConditions],
  };
};

const buildAdminMetricsPayload = async () => {
  const totalMetric = await SiteMetric.findOne({ key: 'site_visits' });
  const apkDownloadsMetric = await SiteMetric.findOne({ key: 'mobile_apk_downloads' });
  const totalVisits = Number(totalMetric?.value ?? 0);
  const apkDownloads = Number(apkDownloadsMetric?.value ?? 0);

  const dayKey = getDayKey();
  const todayVisits = await SiteVisit.countDocuments({ dayKey });
  const internalVisits = await SiteVisit.countDocuments(buildInternalVisitQuery());
  const customerVisits = Math.max(0, totalVisits - internalVisits);
  const todayInternalVisits = await SiteVisit.countDocuments(buildInternalVisitQuery({ dayKey }));
  const todayCustomerVisits = Math.max(0, todayVisits - todayInternalVisits);

  const uniqueVisitors = await SiteVisit.distinct('visitorId');
  const uniqueCustomerVisitors = await SiteVisit.distinct('visitorId', buildCustomerVisitQuery());

  const recentVisitsRaw = await SiteVisit.find()
    .sort({ lastVisitedAt: -1 })
    .limit(20)
    .select({ visitorId: 1, ipAddress: 1, lastVisitedAt: 1, isInternalVisit: 1, visitSource: 1, _id: 0 });

  const recentVisits = recentVisitsRaw.map((visit) => {
    const inferredInternalByIp = isInternalIpAddress(visit.ipAddress);
    const isInternalVisit = Boolean(visit.isInternalVisit) || inferredInternalByIp;
    const visitSource = visit.visitSource && visit.visitSource !== 'customer'
      ? visit.visitSource
      : isInternalVisit
        ? 'internal_ip'
        : 'customer';

    return {
      visitorId: String(visit.visitorId || ''),
      ipAddress: String(visit.ipAddress || ''),
      lastVisitedAt: visit.lastVisitedAt,
      isInternalVisit,
      visitSource,
    };
  });

  return {
    totalVisits,
    apkDownloads,
    customerVisits,
    internalVisits,
    todayVisits,
    todayCustomerVisits,
    uniqueVisitors: uniqueVisitors.length,
    uniqueCustomerVisitors: uniqueCustomerVisitors.length,
    recentVisits,
  };
};

const getVisitClassification = ({ ipAddress, isAdminVisit }) => {
  if (isAdminVisit) {
    return { isInternalVisit: true, visitSource: 'admin' };
  }

  const normalizedIp = normalizeIp(ipAddress);
  const isInternalExact = normalizedIp && INTERNAL_IP_WHITELIST.has(normalizedIp);
  const isInternalByPrefix = normalizedIp
    && INTERNAL_IP_PREFIX_WHITELIST.some((prefix) => normalizedIp.startsWith(prefix));

  if (isInternalExact || isInternalByPrefix) {
    return { isInternalVisit: true, visitSource: 'internal_ip' };
  }

  return { isInternalVisit: false, visitSource: 'customer' };
};

const getDayKey = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ECUADOR_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
};

// Conectar a MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/flstore';

mongoose.connect(MONGODB_URI)
  .then(async () => {
    console.log('✅ Conectado a MongoDB');
    // Inicializar usuario admin si no existe
    const userCount = await User.countDocuments();
    if (userCount === 0) {
      const seedUsername = String(process.env.ADMIN_SEED_USERNAME || '').trim();
      const seedPassword = String(process.env.ADMIN_SEED_PASSWORD || '').trim();

      if (!seedUsername || !seedPassword) {
        console.warn('⚠️ No se creó usuario admin inicial: define ADMIN_SEED_USERNAME y ADMIN_SEED_PASSWORD');
        return;
      }

      const hashedPassword = await bcrypt.hash(seedPassword, 12);

      await User.create({
        username: seedUsername,
        password: hashedPassword,
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
    const internalVisits = await SiteVisit.countDocuments(buildInternalVisitQuery());
    const customerVisits = Math.max(0, totalVisits - internalVisits);

    return res.json({
      totalVisits,
      customerVisits,
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
    const isAdminVisit = Boolean(req.body?.isAdminVisit);
    if (!visitorId) {
      return res.status(400).json({ error: 'visitorId es obligatorio' });
    }

    const now = new Date();
    const dayKey = getDayKey();
    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 255);
    const visitClassification = getVisitClassification({ ipAddress, isAdminVisit });

    const existingVisit = await SiteVisit.findOne({ visitorId, dayKey });

    if (existingVisit) {
      existingVisit.lastVisitedAt = now;
      if (ipAddress) {
        existingVisit.ipAddress = ipAddress;
      }
      if (userAgent) {
        existingVisit.userAgent = userAgent;
      }
      existingVisit.isInternalVisit = visitClassification.isInternalVisit;
      existingVisit.visitSource = visitClassification.visitSource;
      await existingVisit.save();

      const currentMetric = await SiteMetric.findOne({ key: 'site_visits' });
      const internalVisits = await SiteVisit.countDocuments(buildInternalVisitQuery());
      const customerVisits = Math.max(0, Number(currentMetric?.value ?? 0) - internalVisits);
      return res.status(200).json({
        totalVisits: Number(currentMetric?.value ?? 0),
        customerVisits,
      });
    }

    await SiteVisit.create({
      visitorId,
      dayKey,
      ipAddress,
      userAgent,
      isInternalVisit: visitClassification.isInternalVisit,
      visitSource: visitClassification.visitSource,
      firstVisitedAt: now,
      lastVisitedAt: now,
    });

    const updatedMetric = await SiteMetric.findOneAndUpdate(
      { key: 'site_visits' },
      { $inc: { value: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const internalVisits = await SiteVisit.countDocuments(buildInternalVisitQuery());
    const customerVisits = Math.max(0, Number(updatedMetric?.value ?? 0) - internalVisits);

    return res.status(201).json({
      totalVisits: Number(updatedMetric?.value ?? 0),
      customerVisits,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al registrar visita' });
  }
});

// Métricas admin de visitas
app.get('/api/metrics/admin', requireAdminAuth, async (req, res) => {
  try {
    const payload = await buildAdminMetricsPayload();
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener métricas admin' });
  }
});

// Recalcular métricas históricas y clasificación de visitas internas
app.post('/api/metrics/admin/recalculate', requireAdminAuth, async (req, res) => {
  try {
    const internalIpConditions = buildInternalIpConditions();

    if (internalIpConditions.length > 0) {
      await SiteVisit.updateMany(
        {
          visitSource: { $ne: 'admin' },
          $or: internalIpConditions,
        },
        {
          $set: {
            isInternalVisit: true,
            visitSource: 'internal_ip',
          },
        }
      );

      await SiteVisit.updateMany(
        {
          visitSource: { $ne: 'admin' },
          $nor: internalIpConditions,
        },
        {
          $set: {
            isInternalVisit: false,
            visitSource: 'customer',
          },
        }
      );
    } else {
      await SiteVisit.updateMany(
        {
          visitSource: { $ne: 'admin' },
        },
        {
          $set: {
            isInternalVisit: false,
            visitSource: 'customer',
          },
        }
      );
    }

    await SiteVisit.updateMany(
      { visitSource: 'admin' },
      { $set: { isInternalVisit: true } }
    );

    const totalVisits = await SiteVisit.countDocuments();
    await SiteMetric.findOneAndUpdate(
      { key: 'site_visits' },
      { $set: { value: totalVisits } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const payload = await buildAdminMetricsPayload();
    return res.json({
      message: 'Métricas recalculadas correctamente',
      ...payload,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al recalcular métricas históricas' });
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

app.get('/api/products/:id/audit', requireAdminAuth, async (req, res) => {
  try {
    const auditLogs = await ProductChangeLog.find({ productId: req.params.id })
      .sort({ createdAt: -1 });

    return res.json(auditLogs);
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener trazabilidad del producto' });
  }
});

// Registrar token push de app móvil
app.post('/api/mobile/push-token', async (req, res) => {
  try {
    const rawToken = String(req.body?.token || '').trim();
    const platform = normalizePlatform(req.body?.platform);

    if (!isValidExpoPushToken(rawToken)) {
      return res.status(400).json({ error: 'Token push inválido' });
    }

    await MobilePushToken.findOneAndUpdate(
      { token: rawToken },
      {
        $set: {
          token: rawToken,
          platform,
          active: true,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ message: 'Token push registrado' });
  } catch (error) {
    return res.status(500).json({ error: 'Error al registrar token push' });
  }
});

// Desactivar token push (logout/desinstalación)
app.delete('/api/mobile/push-token', async (req, res) => {
  try {
    const rawToken = String(req.body?.token || '').trim();
    if (!rawToken) {
      return res.status(400).json({ error: 'Token push requerido' });
    }

    await MobilePushToken.findOneAndUpdate(
      { token: rawToken },
      { $set: { active: false, lastSeenAt: new Date() } },
      { new: true }
    );

    return res.json({ message: 'Token push desactivado' });
  } catch (error) {
    return res.status(500).json({ error: 'Error al desactivar token push' });
  }
});

app.post('/api/mobile/push/test', requireAdminAuth, async (req, res) => {
  try {
    const title = String(req.body?.title || '🔔 Prueba de notificaciones').trim();
    const body = String(req.body?.body || 'Notificación de prueba FL Store').trim();

    const activeTokens = await MobilePushToken.countDocuments({ active: true });
    const result = await sendExpoPushNotificationToAll({
      title,
      body,
      data: {
        type: 'manual_test',
        sentAt: new Date().toISOString(),
      },
    });

    return res.json({
      message: 'Notificación de prueba enviada',
      activeTokens,
      delivered: Number(result?.delivered ?? 0),
      invalidated: Number(result?.invalidated ?? 0),
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al enviar notificación de prueba' });
  }
});

app.get('/api/mobile/push/stats', requireAdminAuth, async (req, res) => {
  try {
    const [totalTokens, activeTokens, androidActive, iosActive, webActive] = await Promise.all([
      MobilePushToken.countDocuments(),
      MobilePushToken.countDocuments({ active: true }),
      MobilePushToken.countDocuments({ active: true, platform: 'android' }),
      MobilePushToken.countDocuments({ active: true, platform: 'ios' }),
      MobilePushToken.countDocuments({ active: true, platform: 'web' }),
    ]);

    const lastToken = await MobilePushToken.findOne({ active: true })
      .sort({ lastSeenAt: -1 })
      .select({ lastSeenAt: 1, _id: 0 });

    return res.json({
      totalTokens,
      activeTokens,
      activeByPlatform: {
        android: androidActive,
        ios: iosActive,
        web: webActive,
      },
      lastSeenAt: lastToken?.lastSeenAt ?? null,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener estadísticas de tokens push' });
  }
});

app.post('/api/mobile/apk-downloads/recalculate', requireAdminAuth, async (req, res) => {
  try {
    const totalUniqueDownloads = await MobileApkDownload.countDocuments();

    await SiteMetric.findOneAndUpdate(
      { key: 'mobile_apk_downloads' },
      { $set: { value: totalUniqueDownloads } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({
      message: 'Contador de descargas APK recalculado correctamente',
      downloadCount: totalUniqueDownloads,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al recalcular descargas APK' });
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

app.get('/api/products/version', async (req, res) => {
  try {
    const [totalProducts, lastProduct] = await Promise.all([
      Product.countDocuments(),
      Product.findOne().sort({ updatedAt: -1 }).select({ updatedAt: 1, _id: 0 }),
    ]);

    return res.json({
      totalProducts,
      lastUpdatedAt: lastProduct?.updatedAt ?? null,
      version: `${totalProducts}-${lastProduct?.updatedAt ? new Date(lastProduct.updatedAt).toISOString() : 'none'}`,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener versión de productos' });
  }
});

// Crear producto
app.post('/api/products', requireAdminAuth, async (req, res) => {
  try {
    const newProduct = await Product.create({
      id: Date.now().toString(),
      isEnabled: req.body?.isEnabled !== false,
      ...req.body
    });

    await registerProductChangeLog({
      productId: newProduct.id,
      operation: 'create',
      req,
      changedFields: buildProductFieldDiff(null, newProduct),
      productSnapshot: newProduct.toObject(),
    });

    try {
      const pushResult = await notifyProductCreated(newProduct);
      console.log(`📲 Push nuevo producto enviado. delivered=${pushResult.delivered} invalidated=${pushResult.invalidated}`);
    } catch (pushError) {
      console.error('❌ Error enviando push de nuevo producto:', pushError?.message || 'Sin detalle');
    }

    res.status(201).json(newProduct);
  } catch (error) {
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// Actualizar producto
app.put('/api/products/:id', requireAdminAuth, async (req, res) => {
  try {
    const existingProduct = await Product.findOne({ id: req.params.id });
    if (!existingProduct) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const previousPrice = Number(existingProduct.price);
    const previousEnabled = existingProduct.isEnabled !== false;

    const updates = {
      ...req.body,
      id: req.params.id,
    };

    if (typeof req.body?.isEnabled !== 'boolean') {
      updates.isEnabled = existingProduct.isEnabled !== false;
    }

    const product = await Product.findOneAndUpdate(
      { id: req.params.id },
      updates,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const changedFields = buildProductFieldDiff(existingProduct, product);

    if (changedFields.length > 0) {
      await registerProductChangeLog({
        productId: product.id,
        operation: 'update',
        req,
        changedFields,
        productSnapshot: product.toObject(),
      });
    }

    const updatedPrice = Number(product.price);
    const currentEnabled = product.isEnabled !== false;
    const enabledChanged = previousEnabled !== currentEnabled;
    const priceChanged = Number.isFinite(previousPrice) && Number.isFinite(updatedPrice) && previousPrice !== updatedPrice;
    const hasAnyChange = [
      String(existingProduct.name || '').trim() !== String(product.name || '').trim(),
      String(existingProduct.description || '').trim() !== String(product.description || '').trim(),
      String(existingProduct.category || '').trim() !== String(product.category || '').trim(),
      String(existingProduct.image || '').trim() !== String(product.image || '').trim(),
      Boolean(existingProduct.isNew) !== Boolean(product.isNew),
      Boolean(existingProduct.isEnabled !== false) !== Boolean(product.isEnabled !== false),
      priceChanged,
    ].some(Boolean);

    if (enabledChanged && currentEnabled) {
      try {
        const pushResult = await notifyProductEnabled(product);
        console.log(`📲 Push producto habilitado enviado. delivered=${pushResult.delivered} invalidated=${pushResult.invalidated}`);
      } catch (pushError) {
        console.error('❌ Error enviando push de producto habilitado:', pushError?.message || 'Sin detalle');
      }
    } else if (enabledChanged && !currentEnabled) {
      try {
        const pushResult = await notifyProductDisabled(product);
        console.log(`📲 Push producto deshabilitado enviado. delivered=${pushResult.delivered} invalidated=${pushResult.invalidated}`);
      } catch (pushError) {
        console.error('❌ Error enviando push de producto deshabilitado:', pushError?.message || 'Sin detalle');
      }
    } else if (priceChanged) {
      try {
        const pushResult = await notifyProductPriceUpdated({ product, previousPrice });
        console.log(`📲 Push cambio de precio enviado. delivered=${pushResult.delivered} invalidated=${pushResult.invalidated}`);
      } catch (pushError) {
        console.error('❌ Error enviando push de cambio de precio:', pushError?.message || 'Sin detalle');
      }
    } else if (hasAnyChange) {
      try {
        const pushResult = await notifyProductUpdated(product);
        console.log(`📲 Push actualización de producto enviado. delivered=${pushResult.delivered} invalidated=${pushResult.invalidated}`);
      } catch (pushError) {
        console.error('❌ Error enviando push de actualización de producto:', pushError?.message || 'Sin detalle');
      }
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
});

// Eliminar producto
app.delete('/api/products/:id', requireAdminAuth, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({ id: req.params.id });
    if (product) {
      await registerProductChangeLog({
        productId: product.id,
        operation: 'delete',
        req,
        changedFields: buildProductFieldDiff(product, null),
        productSnapshot: product.toObject(),
      });

      res.json({ message: 'Producto eliminado' });
    } else {
      res.status(404).json({ error: 'Producto no encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
});

// Subir imagen a Cloudinary
app.post('/api/upload', requireAdminAuth, upload.single('image'), async (req, res) => {
  try {
    const hasCloudinaryConfig = Boolean(
      String(process.env.CLOUDINARY_CLOUD_NAME || '').trim()
      && String(process.env.CLOUDINARY_API_KEY || '').trim()
      && String(process.env.CLOUDINARY_API_SECRET || '').trim()
    );

    if (!hasCloudinaryConfig) {
      return res.status(500).json({ error: 'Cloudinary no está configurado en el servidor' });
    }

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
    if (!ADMIN_JWT_SECRET) {
      return res.status(500).json({ success: false, error: 'ADMIN_JWT_SECRET no configurado en backend' });
    }

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const user = await User.findOne({ username });
    const isValidPassword = await verifyAndUpgradePassword(user, password);

    if (user && isValidPassword) {
      const token = jwt.sign(
        { username: String(user.username || '') },
        ADMIN_JWT_SECRET,
        { expiresIn: ADMIN_TOKEN_EXPIRES_IN }
      );

      res.json({
        success: true,
        message: 'Login exitoso',
        token,
        expiresIn: ADMIN_TOKEN_EXPIRES_IN,
      });
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

    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 255);

    const review = await Review.create({
      customerName: String(customerName).trim(),
      productId: String(productId).trim(),
      productName: String(productName).trim(),
      category: String(category).trim(),
      rating: normalizedRating,
      comment: String(comment).trim(),
      recommend: Boolean(recommend),
      status: 'pending',
      createdFromIp: ipAddress,
      createdFromUserAgent: userAgent,
      moderationHistory: [{
        status: 'pending',
        changedBy: 'system',
        ipAddress,
        userAgent,
        changedAt: new Date(),
      }],
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

// Obtener reseñas públicas aprobadas y métricas
app.get('/api/reviews/public', async (req, res) => {
  try {
    const visitorId = String(req.query.visitorId || '').trim();

    const approvedReviews = await Review.find({ status: 'approved' })
      .sort({ createdAt: -1 });

    const publicReviews = approvedReviews.map((review) => {
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
      reviews: publicReviews,
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
app.get('/api/reviews/admin', requireAdminAuth, async (req, res) => {
  try {
    const reviews = await Review.find().sort({ createdAt: -1 });
    res.json(reviews);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener reseñas para admin' });
  }
});

// Cambiar estado de reseña (aprobar/rechazar)
app.patch('/api/reviews/:id/status', requireAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const ipAddress = getClientIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 255);
    const adminUsername = String(req.adminUser?.username || '').trim() || 'admin';

    const review = await Review.findByIdAndUpdate(
      req.params.id,
      {
        $set: { status },
        $push: {
          moderationHistory: {
            status,
            changedBy: adminUsername,
            ipAddress,
            userAgent,
            changedAt: new Date(),
          },
        },
      },
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
