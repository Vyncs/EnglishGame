import 'dotenv/config';
// Validação de env crítica no boot — falha alto em produção
// se JWT_SECRET ausente/fraco. Importar antes de qualquer rota.
import { getJwtSecret } from './utils/env.js';
getJwtSecret();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
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
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import englishCoachRoutes from './routes/englishCoach.js';
import englishCoachMemoryRoutes from './routes/englishCoachMemory.js';
import progressRoutes from './routes/progress.js';
import missionsRoutes from './routes/missions.js';
import activityRoutes from './routes/activity.js';

const app = express();
// Em produção (Render/Netlify) a app fica atrás de proxy. Sem isso, req.ip
// fica errado e o rate-limit por IP é facilmente burlável.
// '1' = confia no primeiro proxy adiante; ajustar se houver mais hops.
app.set('trust proxy', 1);

const serverStartedAt = Date.now();
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
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/english-coach', englishCoachRoutes);
app.use('/api/english-coach/memory', englishCoachMemoryRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/missions', missionsRoutes);
app.use('/api/activity', activityRoutes);

/** Resposta leve (sem DB) — use em ping/cron e monitores (ex.: Render free). */
function sendHealth(_req, res) {
  res.json({
    ok: true,
    service: 'play-flash-cards-api',
    ts: new Date().toISOString(),
    uptimeSec: Math.floor((Date.now() - serverStartedAt) / 1000),
  });
}
app.get('/health', sendHealth);
app.get('/api/health', sendHealth);

// Frontend estático (build do GameEnglish-main/dist) — serve o SPA na mesma origem
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../GameEnglish-main/dist');
app.use(express.static(FRONTEND_DIST));
app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

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
