function stamp(level, args) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  return [`${ts} ${level}`, ...args];
}

export const logger = {
  info: (...args) => console.log(...stamp("INFO", args)),
  warn: (...args) => console.warn(...stamp("WARNING", args)),
  error: (...args) => console.error(...stamp("ERROR", args)),
};
