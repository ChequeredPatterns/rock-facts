import { cache } from 'react';
import { loadDashboard, type DashboardData } from './aggregate';

/**
 * Request-scoped cache. The layout and the page both need dashboard data;
 * without this they would each hit every vendor API on every page view,
 * doubling load and risking rate limits for no benefit.
 */
export const getDashboard = cache(async (): Promise<DashboardData> => loadDashboard());
