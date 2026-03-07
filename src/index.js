import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import authSocialRoutes from './routes/authSocial.js';
import groupsRoutes from './routes/groups.js';
import cardsRoutes from './routes/cards.js';
import syncRoutes from './routes/sync.js';
import memoryRoutes from './routes/memory.js';
import booksRoutes from './routes/books.js';
import preferencesRoutes from './routes/preferences.js';
import paymentsRouter, { stripeWebhookHandler } from './routes/payments.js';
import adminRoutes from './routes/admin.js';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
// CORS: aceita uma URL ou várias separadas por vírgula (ex: https://playfashcards.com.br,https://www.playfashcards.com.br)
const corsOrigins = FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean);

// CORS
app.use(cors({
  origin: corsOrigins.length > 1 ? corsOrigins : corsOrigins[0] || FRONTEND_URL,
  credentials: true,
}));

// Webhook Stripe precisa do body bruto (antes de express.json())
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// JSON e urlencoded (Apple callback usa POST form)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rotas (auth social antes para /api/auth/google etc.)
app.use('/api/auth', authSocialRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/cards', cardsRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/payments', paymentsRouter);
app.use('/api/admin', adminRoutes);

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Middleware global de erro: todas as rotas que chamam next(e) caem aqui
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status ?? err.statusCode ?? 500;
  res.status(status).json({
    error: err.message || 'Erro interno',
    detail: err.message,
  });
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
});
