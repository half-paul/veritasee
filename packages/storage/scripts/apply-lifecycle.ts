import { applyUnanchoredLifecycle, UNANCHORED_PREFIX } from '../src/lifecycle';
import { loadEnv } from '../src/load-env';

loadEnv();

async function main() {
  console.log(`Applying lifecycle: ${UNANCHORED_PREFIX} → expire after 1 day…`);
  await applyUnanchoredLifecycle();
  console.log(`Applied lifecycle: ${UNANCHORED_PREFIX} → expire after 1 day`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
