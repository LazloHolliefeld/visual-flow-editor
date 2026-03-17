import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { writeDatabaseLayoutFile } from './dbLayoutService.js';

const runningServers = new Map(); // Map<serviceName, { process, pid, urls, startedAt }>
const DATAGATEWAY_PORTS = [8080, 8081, 50051];

function getListeningPidsByPorts(ports) {
  try {
    const output = execSync('netstat -ano -p tcp', {
      shell: 'cmd.exe',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    const pids = new Set();
    const portNeedles = ports.map((p) => `:${p}`);

    for (const rawLine of output.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || !line.includes('LISTENING')) continue;
      if (!portNeedles.some((needle) => line.includes(needle))) continue;

      const parts = line.split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) {
        pids.add(pid);
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

function killPidTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { shell: 'cmd.exe', stdio: 'ignore' });
  } catch {
    // Process may already be gone.
  }
}

function killDataGatewayPortProcesses() {
  const pids = getListeningPidsByPorts(DATAGATEWAY_PORTS);
  for (const pid of pids) {
    killPidTree(pid);
  }
}

export function stopAllRunningServers() {
  for (const [name, server] of runningServers) {
    try {
      if (server.pid) {
        execSync(`taskkill /PID ${server.pid} /T /F`, { shell: 'cmd.exe', stdio: 'ignore' });
      }
      server.process?.kill();
    } catch (e) {
      console.log(`Failed to stop ${name}:`, e.message);
    }
  }

  // Also clean up orphan processes not tracked in memory.
  killDataGatewayPortProcesses();
  runningServers.clear();
}

export function getDataGatewayStatus() {
  const server = runningServers.get('datagateway');
  return {
    isRunning: !!server,
    urls: server?.urls || null,
    startedAt: server?.startedAt || null,
  };
}

export async function startDataGateway({ projectData, generateDataGateway, gatewayDir }) {
  // Ensure stale/orphan DataGateway instances are cleared before start.
  killDataGatewayPortProcesses();

  if (runningServers.has('datagateway')) {
    return {
      success: false,
      message: 'DataGateway is already running',
      isRunning: true,
      urls: runningServers.get('datagateway').urls,
    };
  }

  const dbNodes = projectData?.projectNodes?.filter((n) => n.type === 'database' && n.data?.database) || [];
  if (dbNodes.length === 0) {
    return { success: false, message: 'No databases configured' };
  }

  if (!fs.existsSync(gatewayDir)) {
    fs.mkdirSync(gatewayDir, { recursive: true });
  }

  const gatewayCode = generateDataGateway(dbNodes);
  fs.writeFileSync(path.join(gatewayDir, 'main.go'), gatewayCode.main);
  fs.writeFileSync(path.join(gatewayDir, 'handlers.go'), gatewayCode.handlers);
  fs.writeFileSync(path.join(gatewayDir, 'grpc_server.go'), gatewayCode.grpc);
  fs.writeFileSync(path.join(gatewayDir, 'graphql.go'), gatewayCode.graphql);
  fs.writeFileSync(path.join(gatewayDir, 'go.mod'), gatewayCode.goMod);
  writeDatabaseLayoutFile(gatewayDir, dbNodes);

  try {
    execSync('go mod tidy', { cwd: gatewayDir, shell: 'cmd.exe', timeout: 30000 });
  } catch (err) {
    console.log('go mod tidy warning:', err.message);
  }

  const serverProcess = exec('go run .', {
    cwd: gatewayDir,
    shell: 'cmd.exe',
  });

  const urls = {
    rest: 'http://localhost:8080/api/',
    grpc: 'localhost:50051',
    graphql: 'http://localhost:8081/graphql',
  };

  runningServers.set('datagateway', {
    process: serverProcess,
    pid: serverProcess.pid,
    urls,
    startedAt: new Date().toISOString(),
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log('[DataGateway]', data.toString());
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error('[DataGateway Error]', data.toString());
  });

  serverProcess.on('close', (code) => {
    console.log(`[DataGateway] Process exited with code ${code}`);
    runningServers.delete('datagateway');
  });

  await new Promise((r) => setTimeout(r, 2000));

  return {
    success: true,
    message: 'DataGateway started',
    isRunning: true,
    urls,
  };
}

export async function stopDataGateway() {
  // Always kill by known ports first to remove orphaned instances.
  killDataGatewayPortProcesses();

  const server = runningServers.get('datagateway');
  if (!server) {
    return {
      success: true,
      message: 'DataGateway is not running',
      isRunning: false,
    };
  }

  if (server.pid) {
    try {
      execSync(`taskkill /PID ${server.pid} /T /F`, { shell: 'cmd.exe' });
    } catch {
      // process may already be gone
    }
  }

  server.process?.kill();
  runningServers.delete('datagateway');

  return {
    success: true,
    message: 'DataGateway stopped',
    isRunning: false,
  };
}
