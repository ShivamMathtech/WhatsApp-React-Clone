import { createApplication } from './app.mjs';
const instance = createApplication();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
instance.server.listen(port, host, () =>
  console.log(
    `\nWhatsApp Clone is ready: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\nPress Ctrl+C to stop.\n`,
  ),
);
instance.server.on('error', async (error) => {
  console.error(
    error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Close the other app or change PORT in .env.`
      : error.message,
  );
  await instance.close();
  process.exitCode = 1;
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await instance.close();
    process.exitCode = 0;
  });
