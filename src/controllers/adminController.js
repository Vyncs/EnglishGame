import {
  getDashboardMetrics,
  getUsersOverTime,
  listUsers,
  updateUser,
  deleteUser,
  getFinancialMetrics,
} from '../services/metricsService.js';

export async function getMetrics(req, res, next) {
  try {
    const metrics = await getDashboardMetrics();
    res.json(metrics);
  } catch (e) {
    next(e);
  }
}

export async function getCharts(req, res, next) {
  try {
    const data = await getUsersOverTime();
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function getUsers(req, res, next) {
  try {
    const { search, status, page, limit } = req.query;
    const data = await listUsers({
      search: search || '',
      status: status || '',
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
    });
    res.json(data);
  } catch (e) {
    next(e);
  }
}

export async function patchUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await updateUser(id, req.body);
    res.json(user);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    next(e);
  }
}

export async function removeUser(req, res, next) {
  try {
    const { id } = req.params;
    await deleteUser(id);
    res.status(204).end();
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    next(e);
  }
}

export async function getFinancial(req, res, next) {
  try {
    const data = await getFinancialMetrics();
    res.json(data);
  } catch (e) {
    next(e);
  }
}
