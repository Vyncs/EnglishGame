/**
 * Marca um usuário como assinante (subscriptionStatus = 'active').
 * Uso: node scripts/set-subscriber.js <email>
 * Ex.: node scripts/set-subscriber.js vgg00@outlook.com.br
 */
import 'dotenv/config';
import prisma from '../src/db.js';

const email = process.argv[2] || 'vgg00@outlook.com.br';

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
    data: { subscriptionStatus: 'active', subscriptionEndsAt: null },
  });
  console.log('Conta definida como assinante:', user.email);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
