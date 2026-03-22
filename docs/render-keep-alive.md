# Manter o backend acordado no Render (free) + monitor

O plano gratuito do Render **hiberna** o serviço após inatividade. Este projeto expõe health checks **sem banco de dados**:

- `GET https://SEU-SERVICO.onrender.com/health`
- `GET https://SEU-SERVICO.onrender.com/api/health`

Resposta esperada (JSON), exemplo:

```json
{
  "ok": true,
  "service": "play-flash-cards-api",
  "ts": "2026-03-22T12:00:00.000Z",
  "uptimeSec": 12345
}
```

## 1. Ping periódico (cron externo)

Configure um agendador para chamar **uma** das URLs acima a cada **10–14 minutos** (abaixo do tempo típico de sleep).

Opções:

- [cron-job.org](https://cron-job.org) — criar job HTTP GET na URL do `/health`
- [UptimeRobot](https://uptimerobot.com) — monitor HTTP com intervalo mínimo permitido
- GitHub Actions — workflow com `schedule: cron` executando `curl`

Exemplo com `curl` (substitua a URL):

```bash
curl -fsS -o /dev/null -w "%{http_code}\n" "https://SEU-SERVICO.onrender.com/health"
```

Esperado: código `200`.

## 2. Monitor simples (saber se caiu)

Use o mesmo URL no UptimeRobot / Better Stack / etc.:

- **Down**: status ≠ 200 ou timeout → alerta por e-mail.
- **Up**: `ok: true` no JSON confirma que a API respondeu.

Isso **não substitui** instância paga: o primeiro request após dormir pode demorar alguns segundos.

## 3. Render Dashboard

Em **Settings → Health Check Path** do Web Service, você pode definir `/health` se o Render oferecer health check nativo no seu plano (varia com o tipo de serviço).

---

**Nota:** Ping é paliativo; para SLA forte, use plano com instância sempre ligada.
