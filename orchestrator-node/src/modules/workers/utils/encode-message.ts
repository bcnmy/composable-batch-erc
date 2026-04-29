import { Packr } from "msgpackr/pack";

const packr = new Packr({
  useBigIntExtension: true,
});

export function encodeMessage<Message extends object>(messages: Message) {
  return packr.encode(messages);
}
