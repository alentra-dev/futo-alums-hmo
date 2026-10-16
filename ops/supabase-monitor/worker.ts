import { runMonitor, type MonitorEnvironment } from './check';

export default {
  async scheduled(controller: { scheduledTime: number; cron: string }, env: MonitorEnvironment): Promise<void> {
    const result = await runMonitor(env);
    // No keys, heartbeat URLs, response bodies, people, or financial details in logs.
    console.log(JSON.stringify({ event: 'supabase_database_check', scheduledAt: new Date(controller.scheduledTime).toISOString(), ...result }));
    if (!result.ok) throw new Error('Supabase external monitor failed; inspect sanitized check status.');
  },
};
