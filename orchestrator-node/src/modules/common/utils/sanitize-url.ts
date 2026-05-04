export const sanitizeUrl = (value: string) => {
  return value.replace(/https?:\/\/[^\s]+/g, "");
};
