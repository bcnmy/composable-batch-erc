import "reflect-metadata";
import "zod-openapi/extend";
import process from "node:process";
import envEnc from "@chainlink/env-enc";
import dotEnv from "dotenv";

export function setupEnvs() {
  const WORKING_DIR = process.cwd();
  const NODE_ENV = process.env.NODE_ENV || "production";

  dotEnv.config({
    path: [
      `${WORKING_DIR}/.env`, //
      `${WORKING_DIR}/.env.local`,
      `${WORKING_DIR}/.env.${NODE_ENV}`,
      `${WORKING_DIR}/.env.${NODE_ENV}.local`,
    ],
  });

  if (NODE_ENV === "production" || NODE_ENV === "staging") {
    envEnc.config({
      path: `${WORKING_DIR}/keystore/key.enc`,
    });
  }
}
