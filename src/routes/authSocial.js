import { Router } from 'express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import AppleStrategy from 'passport-apple';
import jwt from 'jsonwebtoken';
import prisma from '../db.js';
import { getJwtSecret } from '../utils/env.js';

const router = Router();
const JWT_SECRET = getJwtSecret();
const JWT_EXPIRES = '7d';
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim();

function redirectWithToken(res, token, error = null) {
  const url = new URL(FRONTEND_URL);
  if (error) {
    url.pathname = '/login';
    url.searchParams.set('error', error);
  } else {
    url.pathname = '/';
    url.searchParams.set('token', token);
  }
  res.redirect(url.toString());
}

async function findOrCreateUser(provider, providerId, email, name) {
  const providerField = provider === 'google' ? 'googleId' : provider === 'facebook' ? 'facebookId' : 'appleId';

  const existingByProvider = await prisma.user.findFirst({
    where: { [providerField]: providerId },
    select: { id: true, email: true, name: true, createdAt: true, subscriptionStatus: true },
  });
  if (existingByProvider) return existingByProvider;

  const emailNorm = email?.trim()?.toLowerCase();
  if (emailNorm) {
    const existingByEmail = await prisma.user.findUnique({
      where: { email: emailNorm },
    });
    if (existingByEmail) {
      const updated = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { [providerField]: providerId, emailVerified: true, ...(name?.trim() && { name: name.trim() }) },
        select: { id: true, email: true, name: true, createdAt: true, subscriptionStatus: true },
      });
      return updated;
    }
  }

  if (!emailNorm) return null;

  return prisma.user.create({
    data: {
      email: emailNorm,
      name: name?.trim() || null,
      password: null,
      emailVerified: true,
      [providerField]: providerId,
    },
    select: { id: true, email: true, name: true, createdAt: true, subscriptionStatus: true },
  });
}

// ----- Google -----
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/api/auth/google/callback`,
        scope: ['profile', 'email'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName || profile.name?.givenName;
          if (!email) return done(new Error('Google não retornou email'));
          const user = await findOrCreateUser('google', profile.id, email, name);
          done(null, user);
        } catch (e) {
          done(e);
        }
      }
    )
  );
}

router.get(
  '/google',
  (req, res, next) => {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.redirect(`${FRONTEND_URL}/login?error=Google+login+não+configurado`);
    }
    passport.authenticate('google', { session: false })(req, res, next);
  }
);

router.get(
  '/google/callback',
  (req, res, next) => {
    passport.authenticate('google', { session: false }, async (err, user, _info) => {
      if (err) {
        console.error('Google callback error:', err);
        return redirectWithToken(res, '', 'Erro ao entrar com Google');
      }
      if (!user) return redirectWithToken(res, '', 'Erro ao entrar com Google');
      try {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        redirectWithToken(res, token);
      } catch (e) {
        redirectWithToken(res, '', 'Erro ao gerar sessão');
      }
    })(req, res, next);
  }
);

// ----- Facebook -----
if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: process.env.FACEBOOK_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/api/auth/facebook/callback`,
        profileFields: ['id', 'displayName', 'emails'],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;
          if (!email) return done(new Error('Facebook não retornou email'));
          const user = await findOrCreateUser('facebook', profile.id, email, name);
          done(null, user);
        } catch (e) {
          done(e);
        }
      }
    )
  );
}

router.get(
  '/facebook',
  (req, res, next) => {
    if (!process.env.FACEBOOK_APP_ID) {
      return res.redirect(`${FRONTEND_URL}/login?error=Facebook+login+não+configurado`);
    }
    passport.authenticate('facebook', { session: false, scope: ['email'] })(req, res, next);
  }
);

router.get(
  '/facebook/callback',
  (req, res, next) => {
    passport.authenticate('facebook', { session: false }, async (err, user, _info) => {
      if (err) {
        console.error('Facebook callback error:', err);
        return redirectWithToken(res, '', 'Erro ao entrar com Facebook');
      }
      if (!user) return redirectWithToken(res, '', 'Erro ao entrar com Facebook');
      try {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        redirectWithToken(res, token);
      } catch (e) {
        redirectWithToken(res, '', 'Erro ao gerar sessão');
      }
    })(req, res, next);
  }
);

// ----- Apple (Sign in with Apple) -----
function getApplePrivateKeyPath() {
  if (process.env.APPLE_PRIVATE_KEY_PATH) return process.env.APPLE_PRIVATE_KEY_PATH;
  if (process.env.APPLE_PRIVATE_KEY) {
    const dir = join(tmpdir(), 'english-cards-apple');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, 'AuthKey.p8');
    const keyContent = process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    writeFileSync(path, keyContent, 'utf8');
    return path;
  }
  return null;
}

const appleCallbackURL = process.env.APPLE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:3001'}/api/auth/apple/callback`;
const applePrivateKeyPath = getApplePrivateKeyPath();

if (
  process.env.APPLE_CLIENT_ID &&
  process.env.APPLE_TEAM_ID &&
  process.env.APPLE_KEY_ID &&
  applePrivateKeyPath
) {
  passport.use(
    new AppleStrategy(
      {
        clientID: process.env.APPLE_CLIENT_ID,
        teamID: process.env.APPLE_TEAM_ID,
        keyID: process.env.APPLE_KEY_ID,
        privateKeyLocation: applePrivateKeyPath,
        callbackURL: appleCallbackURL,
        passReqToCallback: true,
      },
      async (req, _accessToken, _refreshToken, idToken, _profile, done) => {
        try {
          const decoded = jwt.decode(idToken);
          if (!decoded || !decoded.sub) return done(new Error('Token Apple inválido'));
          const sub = decoded.sub;
          let email = decoded.email || null;
          let name = null;
          if (req.body?.user) {
            try {
              const userBody = typeof req.body.user === 'string' ? JSON.parse(req.body.user) : req.body.user;
              if (userBody.name) {
                const first = userBody.name.firstName || '';
                const last = userBody.name.lastName || '';
                name = [first, last].filter(Boolean).join(' ').trim() || null;
              }
              if (userBody.email) email = userBody.email;
            } catch (_) {}
          }
          if (!email) email = decoded.email || null;
          const user = await findOrCreateUser('apple', sub, email, name);
          if (!user) return done(new Error('Email não autorizado ou não fornecido pela Apple'));
          done(null, user);
        } catch (e) {
          done(e);
        }
      }
    )
  );
}

router.get(
  '/apple',
  (req, res, next) => {
    if (!process.env.APPLE_CLIENT_ID || !applePrivateKeyPath) {
      return res.redirect(`${FRONTEND_URL}/login?error=Apple+login+não+configurado`);
    }
    passport.authenticate('apple', { session: false })(req, res, next);
  }
);

router.post(
  '/apple/callback',
  (req, res, next) => {
    passport.authenticate('apple', { session: false }, async (err, user, _info) => {
      if (err) {
        console.error('Apple callback error:', err);
        return redirectWithToken(res, '', err.message || 'Erro ao entrar com Apple');
      }
      if (!user) return redirectWithToken(res, '', 'Erro ao entrar com Apple');
      try {
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        redirectWithToken(res, token);
      } catch (e) {
        redirectWithToken(res, '', 'Erro ao gerar sessão');
      }
    })(req, res, next);
  }
);

export default router;
