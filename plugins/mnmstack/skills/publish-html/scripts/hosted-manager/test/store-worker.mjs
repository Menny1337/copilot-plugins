import { PageStore } from '../store.mjs';
process.once('message', async ({ config, request, actor, pause }) => {
  try {
    const store = await new PageStore(config, {
      checkpoint: async stage => {
        if (pause && stage === 'prepared') {
          process.send({ stage });
          await new Promise(resolve => process.once('message', resolve));
        }
      },
    }).initialize();
    const result = await store.mutate(request, actor);
    process.send({ result });
  } catch (error) { process.send({ code: error.code, error: 'Synthetic worker operation failed.' }); }
  process.disconnect();
});
