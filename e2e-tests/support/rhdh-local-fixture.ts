import fs from 'fs-extra';
import { exec as execCallback, execSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

import { log } from './plugin-export-build';

const exec = promisify(execCallback);

export type SupportedContainerTool = 'podman' | 'docker';

/**
 * Locates an executable in standard system directories to avoid relying on PATH resolution.
 */
export function findExecutable(name: string): string | undefined {
  const candidates = [
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Synchronously checks if a container tool has working compose support on the current host.
 * Actually verifies that the compose engine can query runtime status.
 */
export function isComposeAvailableSync(tool: SupportedContainerTool): boolean {
  const bin = findExecutable(tool);
  if (!bin) {
    return false;
  }
  try {
    execSync(`echo "services: {}" | ${bin} compose -f - ps`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Synchronously detects container tools with working compose commands.
 * Useful for Jest describe-level conditionals evaluated at module load.
 */
export function detectAvailableComposeToolsSync(): SupportedContainerTool[] {
  const tools: SupportedContainerTool[] = [];
  const envTool = process.env.CONTAINER_TOOL as
    | SupportedContainerTool
    | undefined;

  const candidates: SupportedContainerTool[] =
    envTool === 'docker' || envTool === 'podman'
      ? [envTool, envTool === 'docker' ? 'podman' : 'docker']
      : ['docker', 'podman'];

  for (const tool of candidates) {
    if (isComposeAvailableSync(tool) && !tools.includes(tool)) {
      tools.push(tool);
    }
  }
  return tools;
}

/**
 * Finds an available TCP port starting from the requested port.
 */
export async function findAvailablePort(startPort = 7007): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    server.once('listening', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address ? address.port : startPort;
      server.close(() => resolve(port));
    });
    server.listen(startPort);
  });
}

export interface RhdhLocalFixtureOptions {
  port?: number;
}

/**
 * Creates a lightweight RHDH-Local-shaped fixture directory.
 * Uses nginx:alpine as a fast HTTP 200 responder on port 7007 and alpine:latest
 * as a fast-exiting installer container to trigger real die/died events.
 */
export async function createRhdhLocalFixture(
  targetDir: string,
  options: RhdhLocalFixtureOptions = {},
): Promise<{ runtimeDir: string; port: number }> {
  const port = options.port ?? (await findAvailablePort(7007));
  const runtimeDir = path.resolve(targetDir);

  await fs.ensureDir(path.join(runtimeDir, 'configs/dynamic-plugins'));
  await fs.ensureDir(path.join(runtimeDir, 'configs/app-config'));
  await fs.ensureDir(path.join(runtimeDir, 'local-plugins'));

  const composeContent = [
    'services:',
    '  rhdh:',
    '    container_name: rhdh',
    '    image: nginx:alpine',
    '    ports:',
    `      - "${port}:80"`,
    '  install-dynamic-plugins:',
    '    container_name: rhdh-plugins-installer',
    '    image: alpine:latest',
    '    command: ["sh", "-c", "echo installer completed; exit 0"]',
  ].join('\n');

  await fs.writeFile(path.join(runtimeDir, 'compose.yaml'), composeContent);

  await fs.writeFile(
    path.join(runtimeDir, 'compose-dynamic-plugins-root.yaml'),
    'services: {}\n',
  );

  const installerScript = path.join(
    runtimeDir,
    'prepare-and-install-dynamic-plugins.sh',
  );
  await fs.writeFile(installerScript, '#!/bin/sh\nexit 0\n');
  await fs.chmod(installerScript, 0o700);

  const startScript = path.join(runtimeDir, 'wait-for-plugins-and-start.sh');
  await fs.writeFile(startScript, '#!/bin/sh\nexit 0\n');
  await fs.chmod(startScript, 0o700);

  await fs.writeFile(
    path.join(runtimeDir, 'default.env'),
    `BASE_URL=http://localhost:${port}\n`,
  );

  await fs.writeFile(
    path.join(
      runtimeDir,
      'configs/dynamic-plugins/dynamic-plugins.override.yaml',
    ),
    'includes: []\n',
  );

  await fs.writeFile(
    path.join(runtimeDir, 'configs/app-config/app-config.yaml'),
    `app:\n  baseUrl: http://localhost:${port}\n`,
  );

  return { runtimeDir, port };
}

/**
 * Forces removal of fixture container names if they were left running.
 */
export async function cleanupContainers(
  containerTool: SupportedContainerTool,
): Promise<void> {
  const bin = findExecutable(containerTool) ?? containerTool;
  try {
    await exec(`${bin} rm -f rhdh rhdh-plugins-installer`, {
      shell: true,
    });
  } catch {
    // containers may not exist; ignore
  }
}

/**
 * Tears down any remaining compose containers and networks for a fixture runtime.
 */
export async function cleanupCompose(
  containerTool: SupportedContainerTool,
  runtimeDir: string,
): Promise<void> {
  const composeFiles = '-f compose.yaml -f compose-dynamic-plugins-root.yaml';
  const bin = findExecutable(containerTool) ?? containerTool;
  try {
    await exec(`${bin} compose ${composeFiles} down -v`, {
      cwd: runtimeDir,
      shell: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    log(`Cleanup warning for ${containerTool} in ${runtimeDir}: ${message}`);
  }
}
