import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const exec = promisify(require('child_process').exec);

async function runCommand(
  command: string,
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  console.log(
    `Executing command: ${command}, in directory: ${options.cwd || process.cwd()}`,
  );

  const { err, stdout, stderr } = await exec(command, {
    shell: true,
    ...options,
  });
  console.log(`Command output: ${stdout}`);
  console.log(`Command error output: ${stderr}`);
  if (err) {
    console.error(`Error executing command: ${command}`);
    console.error(stderr);
    console.error(stdout);
    throw err;
  }
  return { stdout, stderr };
}

async function getDynamicPluginAnnotation(image: string): Promise<object[]> {
  const { stdout } = await runCommand(`podman inspect ${image}`);
  const imageInfo = JSON.parse(stdout)[0];
  const dynamicPackagesAnnotation =
    imageInfo.Annotations['io.backstage.dynamic-packages'];
  return JSON.parse(
    Buffer.from(dynamicPackagesAnnotation, 'base64').toString('utf-8'),
  );
}

describe('export and package backstage-community plugin', () => {
  const GITHUB_REPO_URL = 'https://github.com/backstage/community-plugins.git';
  const CONTAINER_TOOL = process.env.CONTAINER_TOOL || 'podman';
  const TEST_TIMEOUT = 5 * 60 * 1000;
  const RHDH_CLI = path.resolve(__dirname, '../bin/rhdh-cli');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhdh-cli-e2e-'));
  const getClonedRepoPath = () => path.join(tmpDir, 'community-plugins');

  let clonedRepoPath: string;

  jest.setTimeout(TEST_TIMEOUT);

  beforeAll(async () => {
    console.log(`Using rhdh-cli at: ${RHDH_CLI}`);
    console.log(`Test workspace: ${tmpDir}`);
    console.log(`Container tool: ${CONTAINER_TOOL}`);
    console.log('Cloning repository...');

    await runCommand(
      `git clone --depth 1 ${GITHUB_REPO_URL} ${getClonedRepoPath()}`,
    );
  });

  afterAll(async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.removeSync(tmpDir);
    }
  });

  describe.each([
    // path to a plugin in repository, image tag for packaging
    [
      'workspaces/tech-radar/plugins/tech-radar',
      `rhdh-test-tech-radar-frontend:${Date.now()}`,
    ],
    [
      'workspaces/tech-radar/plugins/tech-radar-backend',
      `rhdh-test-tech-radar-backend:${Date.now()}`,
    ],
  ])('plugin in %s directory', (pluginPath, imageTag) => {
    const getFullPluginPath = () => path.join(getClonedRepoPath(), pluginPath);

    beforeAll(async () => {
      console.log(`Installing dependencies in ${getFullPluginPath()}`);
      await runCommand(`yarn install`, {
        cwd: getFullPluginPath(),
      });
      console.log(`Compiling TypeScript in ${getFullPluginPath()}`);
      await runCommand(`npx tsc`, {
        cwd: getFullPluginPath(),
      });
    });

    afterAll(async () => {
      console.log(`Cleaning up image: ${imageTag}`);
      await runCommand(`${CONTAINER_TOOL} rmi -f ${imageTag}`);
    });

    test('should export the plugin', async () => {
      await runCommand(`${RHDH_CLI} plugin export`, {
        cwd: getFullPluginPath(),
      });

      // check if derived package was created and contains a package.json file
      expect(
        fs.existsSync(
          path.join(getFullPluginPath(), 'dist-dynamic/package.json'),
        ),
      ).toBe(true);

      const packageJsonPath = path.join(getFullPluginPath(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const role = packageJson.backstage?.role;
      // if the plugin is a frontend plugin, check also if plugin-manifest.json file exists
      if (role === 'frontend-plugin') {
        // eslint-disable-next-line jest/no-conditional-expect
        expect(
          fs.existsSync(
            path.join(
              getFullPluginPath(),
              'dist-dynamic/dist-scalprum/plugin-manifest.json',
            ),
          ),
        ).toBe(true);
      }
    });

    test('should package the plugin', async () => {
      await runCommand(`${RHDH_CLI} plugin package --tag ${imageTag}`, {
        cwd: getFullPluginPath(),
      });

      const annotation = await getDynamicPluginAnnotation(imageTag);
      expect(annotation).not.toBeNull();
      console.log(`Plugin annotation: ${JSON.stringify(annotation)}`);

      // there should be only one plugin in the annotation
      expect(annotation.length).toBe(1);
      // there should be only one package in the plugin
      expect(Object.keys(annotation[0]).length).toBe(1);

      const key = Object.keys(annotation[0])[0];
      const pluginInfo = annotation[0][key];

      // compare plugin information from package.json from derived package with annotation
      const pluginJson = JSON.parse(
        fs.readFileSync(
          path.join(getFullPluginPath(), 'dist-dynamic', 'package.json'),
          'utf-8',
        ),
      );
      expect(pluginInfo.name).toEqual(pluginJson.name);
      expect(pluginInfo.version).toEqual(pluginJson.version);
      expect(pluginInfo.backstage).toEqual(pluginJson.backstage);

      // check content of the image
      const { stdout } = await runCommand(
        `${CONTAINER_TOOL} create ${imageTag}`,
      );
      const containerId = stdout.trim();
      const imageContentDir = path.join(getFullPluginPath(), imageTag);
      fs.mkdirSync(imageContentDir);
      await runCommand(
        `${CONTAINER_TOOL} cp ${containerId}:/ ${imageContentDir}`,
      );
      await runCommand(`${CONTAINER_TOOL} rm ${containerId}`);

      // Verify the plugin was correctly packaged,
      // by checking that the plugin inside the image has the same number of files as the exported derived package

      await runCommand(`ls -lah ${path.join(imageContentDir, key)}`);
      await runCommand(
        `ls -lah ${path.join(getFullPluginPath(), 'dist-dynamic')}`,
      );

      const filesInImage = fs.readdirSync(path.join(imageContentDir, key));
      const filesInDerivedPackage = fs.readdirSync(
        path.join(getFullPluginPath(), 'dist-dynamic'),
      );
      expect(filesInImage.length).toEqual(filesInDerivedPackage.length);

      // index.json in image should match the annotation
      // parsing and stringifying to ensure no formatting issues
      const indexJson = JSON.parse(fs.readFileSync(
        path.join(imageContentDir, 'index.json'),
        'utf-8',
      ));
      console.log(`Index JSON from image: ${JSON.stringify(indexJson)}`);
      console.log(`Annotation JSON: ${JSON.stringify(annotation)}`);
      expect(indexJson).toEqual(annotation);
    });
  });
});
