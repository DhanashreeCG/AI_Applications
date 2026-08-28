import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const t = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'circle_the_things' }
  });
  
  if (!t) {
    console.log('Template not found!');
    return;
  }

  const structureDefinition: any = t.structureDefinition;
  let updated = false;

  if (structureDefinition && Array.isArray(structureDefinition.items)) {
    for (const item of structureDefinition.items) {
      if (item.image_name) {
        // Convert filename to a search query
        const base = item.image_name.split(/[/\\]/).pop();
        const query = base.replace(/\.(png|jpe?g|gif|webp|svg)$/i, '').replace(/[_-]+/g, ' ').trim();
        item.imageQuery = query;
        delete item.image_name;
        updated = true;
      }
    }
  }

  if (updated) {
    await prisma.worksheetTemplate.update({
      where: { id: t.id },
      data: { structureDefinition }
    });
    console.log('Successfully updated structureDefinition for circle_the_things template.');
  } else {
    console.log('No updates needed.');
  }
  
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
