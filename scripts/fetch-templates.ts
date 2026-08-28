import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const t = await prisma.worksheetTemplate.findFirst({
    where: { slug: 'circle_the_things' },
    select: { templateHtml: true, structureDefinition: true },
  });
  
  if (!t) {
    console.log('Template not found!');
    return;
  }

  console.log('\n=== STRUCTURE DEFINITION ===');
  console.log(JSON.stringify(t.structureDefinition, null, 2));
  
  console.log('\n=== TEMPLATE HTML (first 8000 chars) ===');
  console.log(t.templateHtml.slice(0, 8000));
  
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
