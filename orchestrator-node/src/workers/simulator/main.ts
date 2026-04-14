import "@/common/setup";
import { workerData } from "node:worker_threads";
import { bootstrap } from "./bootstrap";

async function main() {
  await bootstrap(workerData);
}

main().catch(console.error);
