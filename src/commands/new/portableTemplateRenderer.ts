import fs from 'fs-extra';
import handlebars from 'handlebars';
import {
  camelCase,
  kebabCase,
  lowerCase,
  lowerFirst,
  snakeCase,
  startCase,
  upperCase,
  upperFirst,
} from 'lodash';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import recursive from 'recursive-readdir';

const handlebarsHelpers = {
  camelCase,
  kebabCase,
  lowerCase,
  lowerFirst,
  snakeCase,
  startCase,
  upperCase,
  upperFirst,
};

export async function renderPortableTemplate(
  templateDir: string,
  destinationDir: string,
  context: Record<string, unknown>,
  versionProvider: (name: string, versionHint?: string) => string,
  templatedValues: Record<string, string>,
  /**
   * Optional RHDH-owned overlay directory that mirrors the upstream template
   * tree. For each file present here, the overlay version is rendered in place
   * of the upstream file. Use this to patch individual upstream template files
   * that are broken or incompatible with a specific RHDH release — for example,
   * to update a generated test that uses a deprecated API — without forking the
   * entire template.
   *
   * The overlay directory must contain only files that are intentional patches.
   * When the underlying upstream template package is upgraded, verify that each
   * overlay file is still necessary and remove it if the upstream has caught up.
   */
  overlayDir?: string,
): Promise<void> {
  const files = await recursive(templateDir).catch(error => {
    throw new Error(`Failed to read template directory: ${error.message}`);
  });

  const template = handlebars.create();
  template.registerHelper(handlebarsHelpers);
  template.registerHelper({
    versionQuery(name: string, versionHint: unknown) {
      return versionProvider(
        name,
        typeof versionHint === 'string' ? versionHint : undefined,
      );
    },
  });
  let values = context;
  const destinationRoot = resolve(destinationDir);
  for (const [key, value] of Object.entries(templatedValues)) {
    values = {
      ...values,
      [key]: template.compile(value, { strict: true })(values),
    };
  }

  for (const file of files) {
    const relativeFile = relative(templateDir, file);
    if (relativeFile === 'portable-template.yaml') {
      continue;
    }
    const renderedFile = template.compile(relativeFile, { strict: true })(
      values,
    );
    const destinationFile = resolve(destinationRoot, renderedFile);
    const destinationRelative = relative(destinationRoot, destinationFile);
    if (
      destinationRelative === '..' ||
      destinationRelative.startsWith(`..${sep}`) ||
      isAbsolute(destinationRelative)
    ) {
      throw new Error(
        `Template output path escapes destination: ${renderedFile}`,
      );
    }
    await fs.ensureDir(dirname(destinationFile));

    // If an RHDH overlay provides a replacement for this upstream file, use it.
    // The overlay path mirrors the upstream template tree (same relative path).
    const overlayFile = overlayDir ? join(overlayDir, relativeFile) : undefined;
    const sourceFile =
      overlayFile && (await fs.pathExists(overlayFile)) ? overlayFile : file;

    if (sourceFile.endsWith('.hbs')) {
      const destination = destinationFile.replace(/\.hbs$/, '');
      const contents = template.compile(
        (await fs.readFile(sourceFile)).toString(),
        { strict: true },
      )({ ...values, name: basename(destination) });

      await fs.writeFile(destination, contents).catch(error => {
        throw new Error(
          `Failed to create file: ${destination}: ${error.message}`,
        );
      });
    } else {
      await fs.copyFile(sourceFile, destinationFile).catch(error => {
        throw new Error(
          `Failed to copy file to ${destinationFile}: ${error.message}`,
        );
      });
    }
  }
}
