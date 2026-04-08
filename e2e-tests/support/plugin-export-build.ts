import fs from 'fs-extra';
import { exec as execCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ReadEntry } from 'tar';
import * as tar from 'tar';
import axios from 'axios';

const exec = promisify(execCallback);

export const CONTAINER_TOOL = process.env.CONTAINER_TOOL || 'podman';

const LOG_PREFIX = '[e2e]';

export function log(msg: string): void {
  console.log(`${LOG_PREFIX} ${msg}`);
}

export function logSection(title: string): void {
  console.log(`${LOG_PREFIX} --- ${title} ---`);
}

export async function downloadFile(url: string, file: string): Promise<void> {
  log(`Downloading ${url} -> ${file}`);
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream',
  });

  const fileStream = fs.createWriteStream(file);
  response.data.pipe(fileStream);

  return new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
    response.data.on('error', reject);
  });
}

export async function runCommand(
  command: string,
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const cwd = options.cwd || process.cwd();

  try {
    const { stdout, stderr } = await exec(command, {
      shell: true,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
      ...options,
    });
    return { stdout, stderr };
  } catch (err: unknown) {
    const e = err as {
      code?: string | number;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    const out = (e.stdout ?? '').trim() || '(empty)';
    const errOut = (e.stderr ?? '').trim() || '(empty)';
    const enrichedMessage = [
      `Command failed: ${command}`,
      `Cwd: ${cwd}`,
      `Exit code: ${e.code ?? 'N/A'} | Signal: ${e.signal ?? 'N/A'}`,
      '--- stdout ---',
      out,
      '--- stderr ---',
      errOut,
    ].join('\n');

    console.error(`${LOG_PREFIX} COMMAND FAILED: ${command}`);
    console.error(`${LOG_PREFIX} cwd: ${cwd}`);
    console.error(`${LOG_PREFIX} --- stdout ---\n${out}`);
    console.error(`${LOG_PREFIX} --- stderr ---\n${errOut}`);

    throw new Error(enrichedMessage);
  }
}

export async function parseDynamicPluginAnnotation(
  imageAnnotations: Record<string, string>,
): Promise<object[]> {
  const dynamicPackagesAnnotation =
    imageAnnotations['io.backstage.dynamic-packages'];
  return JSON.parse(
    Buffer.from(dynamicPackagesAnnotation, 'base64').toString('utf-8'),
  );
}

export async function getImageMetadata(image: string): Promise<{
  annotations: Record<string, string>;
  labels: Record<string, string>;
}> {
  const { stdout } = await runCommand(`${CONTAINER_TOOL} inspect ${image}`);
  const imageInfo = JSON.parse(stdout)[0];
  return {
    annotations: imageInfo.Annotations || {},
    labels: imageInfo.Labels || {},
  };
}

/**
 * Reject archive members that enable tar-slip or link-based writes outside the target tree.
 * See node-tar README: filter out symbolic links and hard links for untrusted tarballs.
 */
function isSafeArchiveExtractEntry(
  entryPath: string,
  entry: ReadEntry,
): boolean {
  if (path.isAbsolute(entryPath)) {
    return false;
  }
  for (const segment of entryPath.split(/[/\\]/)) {
    if (segment === '..') {
      return false;
    }
  }
  const type = entry.type;
  if (type === 'SymbolicLink' || type === 'Link') {
    return false;
  }
  return true;
}

export interface ExtractGithubArchiveOptions {
  tmpDir: string;
  repoTarballUrl: string;
  /** Env var name; if set, use its value as path to an existing tarball */
  localArchiveEnvVar: string;
  /** Default tarball path under tmpDir when env is unset */
  defaultArchiveBasename: string;
  /** Directory name under tmpDir after extract (e.g. community-plugins-main) */
  extractedDirName: string;
  /** Prefix for log lines (e.g. "Community plugins") */
  logLabel: string;
}

/**
 * Download tarball if needed, extract with strip:1 into tmpDir/extractedDirName.
 */
export async function extractGithubMainArchive(
  options: ExtractGithubArchiveOptions,
): Promise<void> {
  const {
    tmpDir,
    repoTarballUrl,
    localArchiveEnvVar,
    defaultArchiveBasename,
    extractedDirName,
    logLabel,
  } = options;

  let archivePath = path.join(tmpDir, defaultArchiveBasename);
  const envPath = process.env[localArchiveEnvVar];
  if (envPath) {
    archivePath = envPath;
    log(`${logLabel}: path from env ${localArchiveEnvVar}: ${archivePath}`);
  }

  if (fs.existsSync(archivePath)) {
    log(
      `${logLabel}: using existing archive (skipping download): ${archivePath}`,
    );
  } else {
    log(`${logLabel}: archive not found, downloading from ${repoTarballUrl}`);
    await downloadFile(repoTarballUrl, archivePath);
    log(`${logLabel}: downloaded to ${archivePath}`);
  }

  const extractRoot = path.join(tmpDir, extractedDirName);
  log(`${logLabel}: extracting to ${extractRoot}`);
  fs.mkdirSync(extractRoot, { recursive: true });
  await tar.x({
    file: archivePath,
    cwd: extractRoot,
    strip: 1,
    sync: true,
    preservePaths: false,
    filter: isSafeArchiveExtractEntry,
  });
}
