import { type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export async function readDir(
  rootPath: string,
  options: {
    recursive?: boolean;
    filter?: {
      extension?: string;
    };
  } = {},
) {
  const { recursive, filter } = options;

  let dirents: Dirent[] | undefined;

  try {
    const rootPathStat = await stat(rootPath);

    if (rootPathStat.isDirectory()) {
      dirents = await readdir(rootPath, {
        withFileTypes: true,
        recursive,
      });
    }
  } catch {
    // prevents an error from being thrown.
  }

  if (!dirents) {
    return;
  }

  const files: {
    path: string;
    extension: string;
    name: string;
  }[] = [];

  for (const dirent of dirents) {
    if (!dirent.isFile()) {
      continue;
    }

    const path = join(dirent.parentPath, dirent.name);
    const extension = extname(dirent.name);
    const name = basename(dirent.name, extension);

    if (!filter?.extension || filter?.extension === extension) {
      files.push({
        path,
        extension,
        name,
      });
    }
  }

  return files;
}
