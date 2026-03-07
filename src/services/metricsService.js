import prisma from '../db.js';

// ─── Users CRUD ───────────────────────────────────────────────

export async function listUsers({ search, status, page = 1, limit = 20 }) {
  const where = {};

  if (search) {
    where.OR = [
      { email: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (status === 'active') where.subscriptionStatus = 'active';
  else if (status === 'free') where.subscriptionStatus = null;
  else if (status === 'canceled') where.subscriptionStatus = { in: ['canceled', 'past_due'] };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, name: true, role: true,
        subscriptionStatus: true, subscriptionEndsAt: true,
        emailVerified: true, createdAt: true, updatedAt: true,
        _count: { select: { cards: true, groups: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users: users.map(u => ({
      ...u,
      cardsCount: u._count.cards,
      groupsCount: u._count.groups,
      _count: undefined,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function updateUser(id, data) {
  const allowed = {};
  if (data.name !== undefined) allowed.name = data.name;
  if (data.role !== undefined) allowed.role = data.role;
  if (data.subscriptionStatus !== undefined) allowed.subscriptionStatus = data.subscriptionStatus || null;
  if (data.emailVerified !== undefined) allowed.emailVerified = data.emailVerified;

  return prisma.user.update({
    where: { id },
    data: allowed,
    select: {
      id: true, email: true, name: true, role: true,
      subscriptionStatus: true, subscriptionEndsAt: true,
      emailVerified: true, createdAt: true, updatedAt: true,
    },
  });
}

export async function deleteUser(id) {
  return prisma.user.delete({ where: { id } });
}

// ─── Financial Metrics ────────────────────────────────────────

export async function getFinancialMetrics() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const MONTHLY_PRICE = parseFloat(process.env.MERCADOPAGO_PLAN_PRICE || '19.90');
  const ANNUAL_PRICE = MONTHLY_PRICE * 12 * 0.7; // ~30% desconto anual

  const [
    activeSubscriptions,
    canceledThisMonth,
    newPaidThisMonth,
    prevMonthActive,
    totalUsers,
  ] = await Promise.all([
    prisma.user.count({ where: { subscriptionStatus: 'active' } }),
    prisma.user.count({
      where: { subscriptionStatus: { in: ['canceled', 'past_due'] }, updatedAt: { gte: startOfMonth } },
    }),
    prisma.user.count({
      where: { subscriptionStatus: 'active', updatedAt: { gte: startOfMonth } },
    }),
    prisma.user.count({
      where: { subscriptionStatus: 'active', createdAt: { lte: endOfPrevMonth } },
    }),
    prisma.user.count(),
  ]);

  const mrr = activeSubscriptions * MONTHLY_PRICE;
  const arr = mrr * 12;
  const revenueThisMonth = activeSubscriptions * MONTHLY_PRICE;
  const revenuePrevMonth = prevMonthActive * MONTHLY_PRICE;
  const revenueGrowth = revenuePrevMonth > 0
    ? (((revenueThisMonth - revenuePrevMonth) / revenuePrevMonth) * 100)
    : (revenueThisMonth > 0 ? 100 : 0);

  const churnBase = prevMonthActive + canceledThisMonth;
  const churnRate = churnBase > 0 ? ((canceledThisMonth / churnBase) * 100) : 0;
  const conversionRate = totalUsers > 0 ? ((activeSubscriptions / totalUsers) * 100) : 0;

  // Revenue over 6 months
  const revenueOverTime = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const label = start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const active = await prisma.user.count({
      where: { subscriptionStatus: 'active', createdAt: { lte: end } },
    });
    revenueOverTime.push({
      label,
      revenue: Math.round(active * MONTHLY_PRICE * 100) / 100,
      subscribers: active,
    });
  }

  return {
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(arr * 100) / 100,
    activeSubscriptions,
    canceledThisMonth,
    newPaidThisMonth,
    churnRate: Math.round(churnRate * 10) / 10,
    conversionRate: Math.round(conversionRate * 10) / 10,
    revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
    revenueGrowth: Math.round(revenueGrowth * 10) / 10,
    monthlyPrice: MONTHLY_PRICE,
    revenueOverTime,
  };
}

// ─── Dashboard Metrics ────────────────────────────────────────

export async function getDashboardMetrics() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    totalUsers,
    newUsersThisMonth,
    newUsersPrevMonth,
    paidUsers,
    canceledThisMonth,
    paidPrevMonth,
    totalCards,
    newCardsThisMonth,
    totalGroups,
    usersWithCards,
    recentUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.user.count({ where: { createdAt: { gte: startOfPrevMonth, lte: endOfPrevMonth } } }),
    prisma.user.count({ where: { subscriptionStatus: 'active' } }),
    prisma.user.count({
      where: {
        subscriptionStatus: { in: ['canceled', 'past_due'] },
        updatedAt: { gte: startOfMonth },
      },
    }),
    prisma.user.count({
      where: {
        subscriptionStatus: 'active',
        createdAt: { lte: endOfPrevMonth },
      },
    }),
    prisma.card.count(),
    prisma.card.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.group.count(),
    prisma.user.count({ where: { cards: { some: {} } } }),
    prisma.user.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, role: true, subscriptionStatus: true, createdAt: true },
    }),
  ]);

  const churnBase = paidPrevMonth + canceledThisMonth;
  const churn = churnBase > 0 ? ((canceledThisMonth / churnBase) * 100) : 0;

  const conversionRate = totalUsers > 0 ? ((paidUsers / totalUsers) * 100) : 0;

  const growthRate = newUsersPrevMonth > 0
    ? (((newUsersThisMonth - newUsersPrevMonth) / newUsersPrevMonth) * 100)
    : (newUsersThisMonth > 0 ? 100 : 0);

  return {
    overview: {
      totalUsers,
      newUsersThisMonth,
      paidUsers,
      freeUsers: totalUsers - paidUsers,
      conversionRate: Math.round(conversionRate * 10) / 10,
      growthRate: Math.round(growthRate * 10) / 10,
    },
    churn: {
      canceledThisMonth,
      churnRate: Math.round(churn * 10) / 10,
      activeSubscriptions: paidUsers,
    },
    content: {
      totalCards,
      newCardsThisMonth,
      totalGroups,
      usersWithCards,
      avgCardsPerUser: totalUsers > 0 ? Math.round(totalCards / totalUsers) : 0,
    },
    recentUsers,
  };
}

export async function getUsersOverTime() {
  const months = [];
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const label = start.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });

    const [totalUsers, newUsers, paidUsers] = await Promise.all([
      prisma.user.count({ where: { createdAt: { lte: end } } }),
      prisma.user.count({ where: { createdAt: { gte: start, lte: end } } }),
      prisma.user.count({ where: { subscriptionStatus: 'active', createdAt: { lte: end } } }),
    ]);

    months.push({ label, totalUsers, newUsers, paidUsers });
  }

  return months;
}
