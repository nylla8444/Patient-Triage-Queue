function readPort(): number {
  const raw = process.env.PORT ?? "3000";
  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}": must be an integer between 1 and 65535`);
  }

  return port;
}

export const config = {
  port: readPort(),
  dbPath: process.env.DB_PATH || "data/triage.db",
};
