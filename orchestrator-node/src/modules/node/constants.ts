import { resolve } from "node:path";
import { Token } from "typedi";
import { type NodeAccount } from "./interfaces";

export const PACKAGE_FILE_PATH = resolve(__dirname, "../../../package.json");

export const NODE_ACCOUNT_TOKEN = new Token<NodeAccount>();
