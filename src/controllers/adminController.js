import { getDashboardMetrics, getUsersOverTime } from '../services/metricsService.js';

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
