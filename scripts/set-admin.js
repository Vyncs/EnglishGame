/**
 * Promove um usuário a ADMIN.
 * Uso: node scripts/set-admin.js <email>
 * Ex.: node scripts/set-admin.js vgg00@outlook.com.br
 */
import 'dotenv/config';
import prisma from '../src/db.js';

const email = process.argv[2];

if (!email) {
  console.error('Uso: node scripts/set-admin.js <email>');
  process.exit(1);
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
  });
  if (!user) {
    console.error('Usuário não encontrado:', email);
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN' },
  });
  console.log(`Usuário ${user.email} promovido a ADMIN com sucesso.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
