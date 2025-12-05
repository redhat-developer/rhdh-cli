export type SharedPackagesRules = {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
};

export type ResolvedEmbedded = {
  packageName: string;
  version: string;
  dir: string;
  parentPackageName: string;
  alreadyPacked: boolean;
};
