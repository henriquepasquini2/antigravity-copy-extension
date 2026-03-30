const d = require('./out/discovery');
const { AntigravityLsClient } = require('./out/lsClient');
const { formatTrajectoryClean } = require('./out/formatter');

(async () => {
  const info = await d.discoverLanguageServer();
  const client = new AntigravityLsClient(info);
  
  const summaries = await client.getAllCascadeTrajectories();
  const entries = Object.entries(summaries);
  entries.sort((a, b) => {
    const tA = new Date(a[1].lastModifiedTime || a[1].createdTime).getTime();
    const tB = new Date(b[1].lastModifiedTime || b[1].createdTime).getTime();
    return tB - tA;
  });
  
  const [cascadeId] = entries[0];
  const traj = await client.getCascadeTrajectory(cascadeId, 1);
  const output = formatTrajectoryClean(traj, false);
  console.log(output);
})().catch(e => console.error(e.message));
