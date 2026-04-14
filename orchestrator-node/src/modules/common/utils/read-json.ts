import { readFile, stat } from "node:fs/promises";

export async function readJSON<T>(filePath: string) {
  let fileContent: string | undefined;

  try {
    const fileStats = await stat(filePath);

    if (fileStats.isFile()) {
      fileContent = await readFile(filePath, "utf8");
    }
  } catch {
    // prevents an error from being thrown.
  }

  if (!fileContent) {
    return;
  }

  let result: T | null;

  try {
    result = JSON.parse(fileContent);
  } catch {
    // return null on parsing error
    result = null;
  }

  return result;
}
