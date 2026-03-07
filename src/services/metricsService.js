import prisma from '../db.js';

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
