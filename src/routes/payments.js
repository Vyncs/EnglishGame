import { Router } from 'express';
import Stripe from 'stripe';
import prisma from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:3001';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const mercadopagoAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN || null;
const mercadopagoPlanPrice = Number(process.env.MERCADOPAGO_PLAN_PRICE) || 9.9;
const mercadopagoMonthly = Number(process.env.MERCADOPAGO_PLAN_PRICE_MONTHLY) || 19.99;
const mercadopagoAnnual = Number(process.env.MERCADOPAGO_PLAN_PRICE_ANNUAL) || 179;

function getMercadoPagoPlan(plan) {
  if (plan === 'annual') {
    return { unit_price: Math.round(mercadopagoAnnual), title: 'English Cards - Pro Anual', id: 'english-cards-pro-anual' };
  }
  // Mensal: enviar 19.99 (MP pode aceitar 2 decimais; se rejeitar, use MERCADOPAGO_PLAN_PRICE_MONTHLY=20)
  const monthlyPrice = Number(mercadopagoMonthly);
  const unitPrice = Number.isInteger(monthlyPrice) ? monthlyPrice : Math.round(monthlyPrice * 100) / 100;
  return { unit_price: unitPrice, title: 'English Cards - Pro Mensal', id: 'english-cards-pro-mensal' };
}

// POST /api/payments/create-checkout-session — Mercado Pago (preferência) ou Stripe | body: { plan?: 'monthly' | 'annual' }
router.post('/create-checkout-session', authMiddleware, async (req, res, next) => {
  if (mercadopagoAccessToken) {
    try {
      const user = req.user;
      const plan = req.body?.plan === 'annual' ? 'annual' : 'monthly';
      const { unit_price, title, id } = getMercadoPagoPlan(plan);
      const preference = {
        items: [
          {
            id,
            title,
            quantity: 1,
            unit_price,
            currency_id: 'BRL',
          },
        ],
        payer: { email: user.email || undefined },
        back_urls: {
          success: `${FRONTEND_URL}/conta?success=true`,
          failure: `${FRONTEND_URL}/conta?canceled=true`,
          pending: `${FRONTEND_URL}/conta?pending=true`,
        },
        external_reference: String(user.id),
      };
      // auto_return só com HTTPS; em dev (http/localhost) o MP rejeita com "back_url.success must be defined"
      if (FRONTEND_URL.startsWith('https://')) {
        preference.auto_return = 'approved';
      }
      if (API_URL.startsWith('https://')) {
        preference.notification_url = `${API_URL}/api/payments/mercadopago/notification`;
      }
      const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${mercadopagoAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preference),
      });
      if (!mpRes.ok) {
        const errText = await mpRes.text();
        let errDetail;
        try {
          errDetail = JSON.parse(errText);
        } catch {
          errDetail = errText;
        }
        console.error('Mercado Pago preference error:', mpRes.status, errDetail);
        const isDev = process.env.NODE_ENV !== 'production';
        return res.status(500).json({
          error: 'Erro ao criar checkout no Mercado Pago',
          ...(isDev && { detail: errDetail }),
        });
      }
      const data = await mpRes.json();
      const url = data.sandbox_init_point || data.init_point;
      if (!url) return res.status(500).json({ error: 'Mercado Pago não retornou URL de pagamento' });
      return res.json({ url });
    } catch (e) {
      next(e);
    }
  }

  if (stripe && process.env.STRIPE_PRICE_ID) {
    try {
      const user = req.user;
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { userId: user.id },
        });
        customerId = customer.id;
        await prisma.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: customerId },
        });
      }
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${FRONTEND_URL}/conta?success=true`,
        cancel_url: `${FRONTEND_URL}/conta?canceled=true`,
        metadata: { userId: user.id },
        subscription_data: { metadata: { userId: user.id } },
      });
      return res.json({ url: session.url });
    } catch (e) {
      next(e);
    }
  }

  return res.status(503).json({
    error: 'Pagamentos não configurados. Defina MERCADOPAGO_ACCESS_TOKEN ou STRIPE_SECRET_KEY.',
  });
});

// GET /api/payments/mercadopago/notification — notificação do Mercado Pago (topic=payment&id=...)
router.get('/mercadopago/notification', async (req, res) => {
  res.status(200).send();
  const topic = req.query.topic;
  const id = req.query.id;
  if (!mercadopagoAccessToken || topic !== 'payment' || !id) return;
  try {
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { Authorization: `Bearer ${mercadopagoAccessToken}` },
    });
    if (!payRes.ok) return;
    const payment = await payRes.json();
    if (payment.status !== 'approved') return;
    const userId = payment.external_reference;
    if (!userId) return;
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: 'active' },
    });
  } catch (e) {
    console.error('Mercado Pago notification error:', e);
  }
});

// Endpoints de simulação só em dev: alternar entre assinante ativo e plano gratuito para testar disables de features
if (process.env.NODE_ENV !== 'production') {
  router.post('/mercadopago/simulate-notification', authMiddleware, async (req, res, next) => {
    if (!mercadopagoAccessToken) return res.status(503).json({ error: 'Mercado Pago não configurado' });
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { subscriptionStatus: 'active' },
      });
      return res.json({ ok: true, message: 'Assinatura ativada (simulação)' });
    } catch (e) {
      next(e);
    }
  });
  router.post('/mercadopago/simulate-clear-subscription', authMiddleware, async (req, res, next) => {
    try {
      await prisma.user.update({
        where: { id: req.user.id },
        data: { subscriptionStatus: null },
      });
      return res.json({ ok: true, message: 'Plano gratuito (simulação)' });
    } catch (e) {
      next(e);
    }
  });
}

// POST /api/payments/create-portal-session — Stripe Customer Portal ou mensagem MP
router.post('/create-portal-session', authMiddleware, async (req, res, next) => {
  if (mercadopagoAccessToken) {
    return res.status(400).json({
      error: 'Gerenciamento de assinatura pelo Mercado Pago: acesse sua conta no Mercado Pago ou app.',
    });
  }
  if (!stripe) {
    return res.status(503).json({ error: 'Pagamentos não configurados' });
  }
  try {
    const user = req.user;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: 'Nenhuma assinatura encontrada' });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${FRONTEND_URL}/conta`,
    });
    res.json({ url: session.url });
  } catch (e) {
    next(e);
  }
});

// Webhook Stripe — registrar em index com express.raw({ type: 'application/json' })
export async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Webhook não configurado');
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId || session.subscription_data?.metadata?.userId;
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: 'active' },
        });
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const userId = sub.metadata?.userId;
      if (userId) {
        const status = sub.status === 'active' ? 'active' : sub.status === 'canceled' || sub.status === 'unpaid' ? 'canceled' : 'past_due';
        const endsAt = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
        await prisma.user.update({
          where: { id: userId },
          data: { subscriptionStatus: status, subscriptionEndsAt: endsAt },
        });
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    res.status(500).json({ error: 'Webhook handler failed', detail: e?.message });
  }
}

export default router;
