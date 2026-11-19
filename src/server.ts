import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDatabase } from "./db/connection.js";

const db = openDatabase(config.dbPath);
const app = createApp(db);

app.listen(config.port, () => {
  console.log(`Patient Triage Queue API listening on http://localhost:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
});
