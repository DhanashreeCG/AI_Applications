/**
 * Replace the Picture Graph template background image.
 *
 * 1. Set BACKGROUND_IMAGE_PATH below (absolute, or relative to repo root).
 * 2. Run:
 *    npx ts-node -r tsconfig-paths/register scripts/update-picture-graph-background-image.ts
 */
import { updateWorksheetTemplateBackgroundImage } from './shared/update-worksheet-template-background-image';

const TEMPLATE_ID = 'cmtsndfnn002n6cbg6o6ny7t3'; // picture_graph

/** <-- put your background image path here */
const BACKGROUND_IMAGE_PATH = 'C:/Users/shubh/Downloads/sample.png';

async function main(): Promise<void> {
  await updateWorksheetTemplateBackgroundImage({
    templateId: TEMPLATE_ID,
    backgroundImagePath: BACKGROUND_IMAGE_PATH,
    assetFilenameStem: 'picture-graph-background',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
