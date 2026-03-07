import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateVerificationCode, getCodeExpiration, sendVerificationEmail } from '../services/emailService.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = '7d';

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const emailNorm = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: emailNorm } });

    if (existing && existing.emailVerified) {
      return res.status(409).json({ error: 'Este email já está em uso' });
    }

    const code = generateVerificationCode();
    const codeExpires = getCodeExpiration();
    const hash = await bcrypt.hash(password, 10);

    if (existing && !existing.emailVerified) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          password: hash,
          name: name?.trim() || existing.name,
          verificationCode: code,
          verificationCodeExpiresAt: codeExpires,
        },
      });
    } else {
      await prisma.user.create({
        data: {
          email: emailNorm,
          password: hash,
          name: name?.trim() || null,
          emailVerified: false,
          verificationCode: code,
          verificationCodeExpiresAt: codeExpires,
        },
      });
    }

    try {
      await sendVerificationEmail(emailNorm, code);
    } catch (emailErr) {
      console.error('Erro ao enviar email de verificação:', emailErr.message);
      return res.status(502).json({
        error: 'Conta criada, mas não foi possível enviar o email de verificação. Tente reenviar o código na próxima tela.',
        email: emailNorm,
      });
    }

    res.status(201).json({
      message: 'Código de verificação enviado para seu email',
      email: emailNorm,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/verify-email
router.post('/verify-email', async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email e código são obrigatórios' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email já verificado. Faça login.' });
    }

    if (!user.verificationCode || user.verificationCode !== code.trim()) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (!user.verificationCodeExpiresAt || new Date() > user.verificationCodeExpiresAt) {
      return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationCode: null,
        verificationCodeExpiresAt: null,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true, subscriptionStatus: true },
    });

    const token = jwt.sign({ userId: updated.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({ user: updated, token });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório' });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ error: 'Email já verificado. Faça login.' });
    }

    const code = generateVerificationCode();
    const codeExpires = getCodeExpiration();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationCode: code,
        verificationCodeExpiresAt: codeExpires,
      },
    });

    await sendVerificationEmail(user.email, code);

    res.json({ message: 'Novo código enviado para seu email' });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }
    if (!user.password) {
      return res.status(401).json({ error: 'Esta conta usa login social. Entre com Google, Apple ou Facebook.' });
    }
    if (!(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    if (!user.emailVerified) {
      const code = generateVerificationCode();
      const codeExpires = getCodeExpiration();
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationCode: code, verificationCodeExpiresAt: codeExpires },
      });
      await sendVerificationEmail(user.email, code);
      return res.status(403).json({
        error: 'Email não verificado. Enviamos um novo código.',
        needsVerification: true,
        email: user.email,
      });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        subscriptionStatus: user.subscriptionStatus,
      },
      token,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me (requer token)
router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      createdAt: req.user.createdAt,
      subscriptionStatus: req.user.subscriptionStatus,
      subscriptionEndsAt: req.user.subscriptionEndsAt,
    },
  });
});

export default router;
