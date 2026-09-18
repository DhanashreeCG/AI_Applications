/**
 * Replace the Number Names template background image.
 *
 * 1. Set BACKGROUND_IMAGE_PATH below (absolute, or relative to repo root).
 * 2. Run:
 *    npx ts-node -r tsconfig-paths/register scripts/update-number-names-background-image.ts
 */
import { updateWorksheetTemplateBackgroundImage } from './shared/update-worksheet-template-background-image';

const TEMPLATE_ID = 'cmswxebxm0028s4bg6clapv7x'; // number_names

/** <-- put your background image path here */
const BACKGROUND_IMAGE_PATH = 'C:/Users/shubh/Downloads/background.png';

async function main(): Promise<void> {
  await updateWorksheetTemplateBackgroundImage({
    templateId: TEMPLATE_ID,
    backgroundImagePath: BACKGROUND_IMAGE_PATH,
    assetFilenameStem: 'number-names-background',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
