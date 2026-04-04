import { handleAuthRoutes } from './routes/auth.mjs';
import { handleBoothRoutes } from './routes/booths.mjs';
import { handleConfigRoutes } from './routes/config.mjs';
import { handleDashboardRoutes } from './routes/dashboard.mjs';
import { handleExpenseRoutes } from './routes/expenses.mjs';
import { handleFileRoutes } from './routes/files.mjs';
import { handleOrderRoutes } from './routes/orders.mjs';
import { handlePaymentRoutes } from './routes/payments.mjs';
import { handleProjectRoutes } from './routes/projects.mjs';
import { handleStaffRoutes } from './routes/staff.mjs';

const ROUTE_HANDLERS = [
    handleFileRoutes,
    handleAuthRoutes,
    handleProjectRoutes,
    handleStaffRoutes,
    handleConfigRoutes,
    handleBoothRoutes,
    handleExpenseRoutes,
    handleOrderRoutes,
    handlePaymentRoutes,
    handleDashboardRoutes
];

export async function dispatchApiRoutes(context) {
    for (const handleRoute of ROUTE_HANDLERS) {
        const response = await handleRoute(context);
        if (response) return response;
    }
    return null;
}
