import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`Patient Triage Queue API listening on http://localhost:${config.port}`);
});
