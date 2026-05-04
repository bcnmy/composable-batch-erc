import { Packr } from "msgpackr/pack";

const packr = new Packr({
  useBigIntExtension: true,
});

export function decodeMessage<Message extends object>(buffer: Buffer) {
  return packr.decode(Buffer.from(buffer)) as Message;
}
