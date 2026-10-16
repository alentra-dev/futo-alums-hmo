import { probeDatabase, runMonitor } from './check';
import { loadMonitorEnvironment } from './local-config';

try {
  const env = loadMonitorEnvironment();
  const result = process.argv.includes('--with-heartbeat') ? await runMonitor(env) : await probeDatabase(env);
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }));
  if (!result.ok) process.exitCode = 1;
} catch {
  console.error('Monitor configuration could not be loaded. Check the private access file and its permissions.');
  process.exitCode = 1;
}
