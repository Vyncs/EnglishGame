import prisma from '../db.js';

/**
 * Mantém o projeto do Supabase acordado.
 *
 * O plano free pausa o projeto depois de ~7 dias com pouca "atividade de banco
 * do usuário" — e este app só encosta no Postgres quando alguém usa o site.
 * Uma semana sem aluno nenhum e o banco dorme; o Prisma volta a responder
 * `Tenant or user not found` e o login quebra até alguém clicar em Resume no
 * dashboard. A documentação do Supabase diz que "algumas requisições ao banco
 * por dia" já bastam para escapar da pausa.
 *
 * São duas camadas independentes de propósito:
 *   1. este heartbeat, que roda dentro do próprio servidor;
 *   2. o cron do GitHub Actions (.github/workflows/manter-banco-acordado.yml),
 *      que chama /api/health/db de fora e continua valendo se o servidor cair
 *      ou reiniciar.
 *
 * DB_HEARTBEAT_MINUTES=0 desliga. Padrão 360 (6 h → 4 batidas por dia).
 */

/** SELECT 1 no banco. Devolve quantos ms a ida e volta levou. */
export async function pingDb() {
  const inicio = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  return Date.now() - inicio;
}

export function startDbHeartbeat() {
  const minutos = Number(process.env.DB_HEARTBEAT_MINUTES ?? 360);
  if (!Number.isFinite(minutos) || minutos <= 0) {
    console.log('[db-heartbeat] desligado (DB_HEARTBEAT_MINUTES=' + minutos + ')');
    return null;
  }

  const bater = async () => {
    try {
      const ms = await pingDb();
      console.log(`[db-heartbeat] banco ok em ${ms}ms`);
    } catch (e) {
      // Não derruba o servidor: um banco pausado precisa ser retomado no
      // dashboard, e as rotas normais já devolvem erro por conta própria.
      console.error('[db-heartbeat] banco não respondeu:', e.message);
    }
  };

  // Uma batida no boot: se o banco estiver pausado, isso aparece já no log do
  // deploy, em vez de só na primeira tentativa de login de um aluno.
  bater();

  const timer = setInterval(bater, minutos * 60 * 1000);
  // Sem unref o timer segura o event loop e o processo nunca encerra sozinho.
  timer.unref?.();
  console.log(`[db-heartbeat] ligado, a cada ${minutos} min`);
  return timer;
}
