import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES = '7d';

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'Este email já está em uso' });
    }
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: email.trim().toLowerCase(),
        password: hash,
        name: name?.trim() || null,
      },
      select: { id: true, email: true, name: true, createdAt: true, subscriptionStatus: true },
    });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.status(201).json({ user, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
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
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        subscriptionStatus: user.subscriptionStatus,
      },
      token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// GET /api/auth/me (requer token)
router.get('/me', authMiddleware, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      createdAt: req.user.createdAt,
      subscriptionStatus: req.user.subscriptionStatus,
      subscriptionEndsAt: req.user.subscriptionEndsAt,
    },
  });
});

export default router;
